import { z } from "zod";
import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../init";
import {
  PART_STATUSES,
  PRIORITIES,
  STEP_STATUSES,
  attachment,
  folder,
  machine,
  operation,
  part,
  partRevision,
  assembly,
} from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import {
  fetchPartSnapshot,
  flattenAssemblyParts,
  hasOnshapeCredentials,
  onshape,
  OnshapeAuthError,
  parseOnshapeUrl,
} from "@/lib/onshape/client";
import { detectStockType, estimateMinutes, loadTemplateSteps } from "@/lib/routing";
import type { PartStatus, StockType } from "@/lib/db/schema";
import type { db as DbInstance } from "@/lib/db/client";

/**
 * Computes the part's overall status from its operation list. Manual
 * "on_robot" is sticky — once a part is installed on the robot, only the
 * user can take it back out. Otherwise:
 *
 *   no ops / all not_started → ready_to_make
 *   any in_queue/in_progress/complete (not all complete) → in_production
 *   any qc_check → qc
 *   all complete → done
 */
function computePartStatus(
  current: PartStatus,
  ops: Array<{ status: string }>,
): PartStatus {
  if (current === "on_robot") return "on_robot";
  if (ops.length === 0) return "ready_to_make";

  const statuses = ops.map((o) => o.status);
  if (statuses.every((s) => s === "complete")) return "done";
  if (statuses.some((s) => s === "qc_check")) return "qc";
  if (
    statuses.some(
      (s) => s === "in_queue" || s === "in_progress" || s === "complete",
    )
  ) {
    return "in_production";
  }
  return "ready_to_make";
}

/**
 * Recomputes and persists the part's auto-derived status after an
 * operation change. Skips the write if nothing changed.
 */
async function recomputePartStatus(
  db: typeof DbInstance,
  partId: string,
): Promise<void> {
  const row = await db.query.part.findFirst({
    where: eq(part.id, partId),
    with: { operations: true },
  });
  if (!row) return;
  const next = computePartStatus(row.status, row.operations);
  if (next !== row.status) {
    await db
      .update(part)
      .set({ status: next, updatedAt: new Date() })
      .where(eq(part.id, partId));
  }
}

/**
 * Resolves the import-time stock-type hint into a concrete value. `"auto"`
 * is only valid as a request — we never persist it. If the caller asks for
 * auto, we run detection and return the concrete result.
 */
function resolveStockType(
  requested: StockType,
  hint: {
    material: string | null | undefined;
    bboxX?: number | null;
    bboxY?: number | null;
    bboxZ?: number | null;
    name?: string | null;
  },
): StockType {
  return requested === "auto" ? detectStockType(hint) : requested;
}

/**
 * Materials we cannot manufacture in-house and should hide from the importer.
 * "Origin Cube Material" comes from Onshape's default cube template.
 */
const HIDDEN_MATERIALS = new Set(["origin cube material", "default"]);

function isHiddenMaterial(
  material: { displayName?: string; name?: string } | null | undefined,
) {
  const v = (material?.displayName ?? material?.name ?? "").toLowerCase().trim();
  return v.length > 0 && HIDDEN_MATERIALS.has(v);
}

/** Element types that the user can actually pick from in the importer. */
const IMPORTABLE_ELEMENT_TYPES = new Set(["PARTSTUDIO"]);

const drawingSchema = z
  .object({
    fileName: z.string(),
    fileKind: z.enum(["dxf", "svg", "pdf", "step", "stl", "other"]).default("pdf"),
    sizeBytes: z.number().int().min(0),
    url: z.string(), // data: URL or remote URL
  })
  .optional();

const partFilterSchema = z
  .object({
    status: z.enum(PART_STATUSES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    assemblyId: z.string().optional(),
    type: z.enum(["custom", "cots"]).optional(),
    search: z.string().optional(),
    designChanged: z.boolean().optional(),
    /**
     * undefined → no folder filter; null → only un-foldered parts;
     * string → only parts in that folder.
     */
    folderId: z.string().nullable().optional(),
  })
  .optional();

const onshapeRefSchema = z.object({
  documentId: z.string().min(1),
  workspaceId: z.string().optional(),
  versionId: z.string().optional(),
  elementId: z.string().min(1),
  partId: z.string().min(1),
});

export const partsRouter = router({
  list: publicProcedure.input(partFilterSchema).query(async ({ ctx, input }) => {
    const folderClause =
      input?.folderId === null
        ? sql`${part.folderId} IS NULL`
        : input?.folderId
          ? eq(part.folderId, input.folderId)
          : undefined;
    const where = and(
      input?.status ? eq(part.status, input.status) : undefined,
      input?.priority ? eq(part.priority, input.priority) : undefined,
      input?.assemblyId ? eq(part.assemblyId, input.assemblyId) : undefined,
      input?.type ? eq(part.type, input.type) : undefined,
      input?.designChanged ? eq(part.designChanged, true) : undefined,
      folderClause,
      input?.search
        ? or(
            like(part.name, `%${input.search}%`),
            like(part.partNumber, `%${input.search}%`),
            like(part.material, `%${input.search}%`),
          )
        : undefined,
    );
    return ctx.db
      .select()
      .from(part)
      .where(where)
      .orderBy(
        sql`CASE ${part.priority}
          WHEN 'blocking' THEN 0
          WHEN 'high' THEN 1
          WHEN 'normal' THEN 2
          WHEN 'low' THEN 3
        END`,
        desc(part.updatedAt),
      );
  }),

  byId: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.db.query.part.findFirst({
        where: eq(part.id, input.id),
        with: {
          assembly: true,
          folder: true,
          operations: {
            with: { machine: true },
            orderBy: asc(operation.sequence),
          },
          revisions: { orderBy: desc(partRevision.createdAt) },
          attachments: { orderBy: desc(attachment.createdAt) },
        },
      });
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return row;
    }),

  kanban: publicProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(part)
      .orderBy(
        sql`CASE ${part.priority}
          WHEN 'blocking' THEN 0
          WHEN 'high' THEN 1
          WHEN 'normal' THEN 2
          WHEN 'low' THEN 3
        END`,
        desc(part.updatedAt),
      );
    return PART_STATUSES.map((status) => ({
      status,
      parts: rows.filter((r) => r.status === status),
    }));
  }),

  setStatus: publicProcedure
    .input(z.object({ id: z.string(), status: z.enum(PART_STATUSES) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(part)
        .set({ status: input.status, updatedAt: new Date() })
        .where(eq(part.id, input.id));
      return { ok: true };
    }),

  setPriority: publicProcedure
    .input(z.object({ id: z.string(), priority: z.enum(PRIORITIES) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(part)
        .set({ priority: input.priority, updatedAt: new Date() })
        .where(eq(part.id, input.id));
      return { ok: true };
    }),

  setBatchKey: publicProcedure
    .input(z.object({ id: z.string(), batchKey: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(part)
        .set({ batchKey: input.batchKey ?? null, updatedAt: new Date() })
        .where(eq(part.id, input.id));
      return { ok: true };
    }),

  setFolder: publicProcedure
    .input(z.object({ id: z.string(), folderId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      // Validate the folder exists if one was specified.
      if (input.folderId) {
        const f = await ctx.db.query.folder.findFirst({
          where: eq(folder.id, input.folderId),
        });
        if (!f) throw new TRPCError({ code: "NOT_FOUND", message: "Folder not found" });
      }
      await ctx.db
        .update(part)
        .set({ folderId: input.folderId ?? null, updatedAt: new Date() })
        .where(eq(part.id, input.id));
      return { ok: true };
    }),

  bulkSetFolder: publicProcedure
    .input(
      z.object({
        ids: z.array(z.string()).min(1),
        folderId: z.string().nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.folderId) {
        const f = await ctx.db.query.folder.findFirst({
          where: eq(folder.id, input.folderId),
        });
        if (!f) throw new TRPCError({ code: "NOT_FOUND" });
      }
      await ctx.db
        .update(part)
        .set({ folderId: input.folderId ?? null, updatedAt: new Date() })
        .where(inArray(part.id, input.ids));
      return { ok: true, moved: input.ids.length };
    }),

  setStockType: publicProcedure
    .input(z.object({ id: z.string(), stockType: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db.query.part.findFirst({
        where: eq(part.id, input.id),
      });
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      // "auto" is a re-detect command, not a value to store.
      const resolved = resolveStockType(input.stockType, {
        material: row.material,
        bboxX: row.bboxXMm,
        bboxY: row.bboxYMm,
        bboxZ: row.bboxZMm,
        name: row.name,
      });
      await ctx.db
        .update(part)
        .set({ stockType: resolved, updatedAt: new Date() })
        .where(eq(part.id, input.id));
      // Re-route operations from scratch so the new template takes effect.
      if (row.type === "custom") {
        await ctx.db.delete(operation).where(eq(operation.partId, input.id));
        const machines = await ctx.db.select().from(machine);
        const steps = await loadTemplateSteps(ctx.db, resolved);
        for (let i = 0; i < steps.length; i++) {
          const s = steps[i];
          const m =
            (s.machineId && machines.find((mc) => mc.id === s.machineId)) ||
            machines.find((mc) => mc.kind === s.kind);
          await ctx.db.insert(operation).values({
            partId: input.id,
            machineId: m?.id ?? null,
            sequence: i,
            name: s.name,
            estMinutes: Math.round(s.estMinutes),
            autoAssigned: true,
          });
        }
      }
      return { ok: true, stockType: resolved };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Cascade kills operations / revisions / attachments (FKs are
      // ON DELETE CASCADE on those references).
      await ctx.db.delete(part).where(eq(part.id, input.id));
      return { ok: true };
    }),

  /**
   * Kick off manufacturing for a part: queues the first non-complete
   * operation and bumps the part status. Idempotent — calling on a
   * part that's already underway just no-ops.
   */
  startManufacturing: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const ops = await ctx.db
        .select()
        .from(operation)
        .where(eq(operation.partId, input.id))
        .orderBy(asc(operation.sequence));
      if (ops.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Add at least one operation before starting manufacturing.",
        });
      }
      const firstPending = ops.find((o) => o.status !== "complete");
      if (!firstPending) {
        return {
          ok: false as const,
          reason: "all_complete" as const,
        };
      }
      if (firstPending.status === "not_started") {
        await ctx.db
          .update(operation)
          .set({ status: "in_queue" })
          .where(eq(operation.id, firstPending.id));
      }
      await recomputePartStatus(ctx.db, input.id);
      return {
        ok: true as const,
        firstStep: firstPending.name,
        machineId: firstPending.machineId,
      };
    }),

  /**
   * Wipe and regenerate operations for one part using the current route
   * template + machine list. Fixes parts whose machines got nulled (e.g.
   * after a destructive seed) without changing the stock type.
   */
  rerouteOperations: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db.query.part.findFirst({
        where: eq(part.id, input.id),
      });
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      if (row.type !== "custom") {
        return { ok: true, steps: 0 };
      }
      await ctx.db.delete(operation).where(eq(operation.partId, input.id));
      const machines = await ctx.db.select().from(machine);
      const steps = await loadTemplateSteps(ctx.db, row.stockType);
      for (let i = 0; i < steps.length; i++) {
        const s = steps[i];
        const m =
          (s.machineId && machines.find((mc) => mc.id === s.machineId)) ||
          machines.find((mc) => mc.kind === s.kind);
        await ctx.db.insert(operation).values({
          partId: input.id,
          machineId: m?.id ?? null,
          sequence: i,
          name: s.name,
          estMinutes: Math.round(s.estMinutes),
          autoAssigned: true,
        });
      }
      return { ok: true, steps: steps.length };
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        notes: z.string().optional(),
        quantity: z.number().int().min(1).optional(),
        material: z.string().optional(),
        priority: z.enum(PRIORITIES).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...patch } = input;
      await ctx.db
        .update(part)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(part.id, id));
      return { ok: true };
    }),

  // ── Onshape connection / discovery ───────────────────────────────────────
  onshapeStatus: publicProcedure.query(() => ({
    connected: hasOnshapeCredentials(),
  })),

  resolveOnshapeUrl: publicProcedure
    .input(z.object({ url: z.string() }))
    .query(async ({ input }) => {
      try {
        const ref = parseOnshapeUrl(input.url);
        if (!ref.workspaceId && !ref.versionId) {
          // We need a workspace to fetch — Onshape returns the default one
          const doc = await onshape.getDocument(ref.documentId);
          ref.workspaceId = doc.defaultWorkspace.id;
        }
        const allElements = await onshape.listElements({
          documentId: ref.documentId,
          workspaceId: ref.workspaceId,
          versionId: ref.versionId,
        });
        // Hide BOM tabs / drawings / blobs — only show elements that we can
        // actually import parts from.
        const elements = allElements.filter((e) =>
          IMPORTABLE_ELEMENT_TYPES.has(e.elementType),
        );
        return { ref, elements };
      } catch (err) {
        if (err instanceof OnshapeAuthError) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: err.message,
          });
        }
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (err as Error).message,
        });
      }
    }),

  /**
   * Lazy-fetch the contents of a specific element. For a Part Studio we return
   * the parts list; for an Assembly we flatten the root instances and return a
   * count-by-part summary so the user can preview before importing.
   */
  onshapeElementContents: publicProcedure
    .input(
      z.object({
        documentId: z.string(),
        workspaceId: z.string().optional(),
        versionId: z.string().optional(),
        elementId: z.string(),
        elementType: z.enum(["PARTSTUDIO", "ASSEMBLY"]),
      }),
    )
    .query(async ({ input }) => {
      try {
        if (input.elementType === "PARTSTUDIO") {
          const parts = await onshape.listParts({
            documentId: input.documentId,
            workspaceId: input.workspaceId,
            versionId: input.versionId,
            elementId: input.elementId,
          });
          return {
            kind: "parts" as const,
            parts: parts
              .filter((p) => !isHiddenMaterial(p.material))
              .map((p) => ({
                partId: p.partId,
                name: p.name,
                partNumber: p.partNumber,
                material:
                  p.material?.displayName ?? p.material?.name ?? null,
                bodyType: p.bodyType,
              })),
          };
        }
        const def = await onshape.assembly({
          documentId: input.documentId,
          workspaceId: input.workspaceId,
          versionId: input.versionId,
          elementId: input.elementId,
        });

        // Recurse through sub-assemblies to pull out every leaf Part instance.
        const leafInstances = flattenAssemblyParts(def);

        type Counted = {
          partId: string;
          name: string;
          documentId: string;
          elementId: string;
          isStandardContent: boolean;
          quantity: number;
          material: string | null;
        };
        const counts = new Map<string, Counted>();
        for (const inst of leafInstances) {
          const did = inst.documentId ?? input.documentId;
          const eid = inst.elementId ?? input.elementId;
          const partMeta = def.parts?.find(
            (p) =>
              p.partId === inst.partId &&
              (!p.elementId || p.elementId === eid),
          );
          if (isHiddenMaterial(partMeta?.material)) continue;

          const key = `${did}|${eid}|${inst.partId}`;
          const existing = counts.get(key);
          if (existing) {
            existing.quantity += 1;
          } else {
            counts.set(key, {
              partId: inst.partId!,
              name: inst.name ?? partMeta?.name ?? inst.partId!,
              documentId: did,
              elementId: eid,
              isStandardContent: Boolean(inst.isStandardContent),
              quantity: 1,
              material:
                partMeta?.material?.displayName ??
                partMeta?.material?.name ??
                null,
            });
          }
        }
        return {
          kind: "instances" as const,
          instances: Array.from(counts.values()),
        };
      } catch (err) {
        if (err instanceof OnshapeAuthError) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: err.message });
        }
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: (err as Error).message,
        });
      }
    }),

  // ── Onshape import ───────────────────────────────────────────────────────
  importPart: publicProcedure
    .input(
      onshapeRefSchema.extend({
        quantity: z.number().int().min(1).default(1),
        type: z.enum(["custom", "cots"]).default("custom"),
        stockType: z.string().default("auto"),
        drawing: drawingSchema,
        vendor: z.string().optional(),
        vendorPartNumber: z.string().optional(),
        unitPriceCents: z.number().int().min(0).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const snap = await fetchPartSnapshot(input);
        const resolvedStockType = resolveStockType(input.stockType, {
          material: snap.material,
          bboxX: snap.bbox?.x,
          bboxY: snap.bbox?.y,
          bboxZ: snap.bbox?.z,
          name: snap.name,
        });
        const [created] = await ctx.db
          .insert(part)
          .values({
            name: snap.name,
            partNumber: snap.partNumber,
            description: null,
            type: input.type,
            quantity: input.quantity,
            stockType: resolvedStockType,
            material: snap.material,
            massGrams: snap.massGrams ?? undefined,
            volumeMm3: snap.volumeMm3 ?? undefined,
            bboxXMm: snap.bbox?.x,
            bboxYMm: snap.bbox?.y,
            bboxZMm: snap.bbox?.z,
            onshapeDocumentId: snap.documentId,
            onshapePartId: snap.partId,
            onshapeElementId: snap.elementId,
            onshapeVersionId: snap.versionId ?? null,
            onshapeMicroversionId: snap.microversionId,
            onshapeUrl: snap.url,
            thumbnailUrl: snap.thumbnailUrl,
            vendor: input.vendor,
            vendorPartNumber: input.vendorPartNumber,
            unitPriceCents: input.unitPriceCents,
            status: "ready_to_make",
            lastSyncedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: part.partNumber,
            set: {
              stockType: resolvedStockType,
              lastSyncedAt: new Date(),
              updatedAt: new Date(),
            },
          })
          .returning();

        await ctx.db.insert(partRevision).values({
          partId: created.id,
          onshapeVersionId: snap.versionId ?? null,
          onshapeMicroversionId: snap.microversionId,
          versionLabel: "v1",
          massGrams: snap.massGrams ?? undefined,
          volumeMm3: snap.volumeMm3 ?? undefined,
          changeSummary: "Initial import from Onshape",
        });

        if (input.drawing) {
          await ctx.db.insert(attachment).values({
            partId: created.id,
            fileName: input.drawing.fileName,
            fileKind: input.drawing.fileKind,
            sizeBytes: input.drawing.sizeBytes,
            url: input.drawing.url,
          });
        }

        if (input.type === "custom") {
          const machines = await ctx.db.select().from(machine);
          const steps = await loadTemplateSteps(ctx.db, resolvedStockType);
          // Replace any old operations if we're re-importing this part with
          // a different stock type.
          await ctx.db
            .delete(operation)
            .where(eq(operation.partId, created.id));
          for (let i = 0; i < steps.length; i++) {
            const s = steps[i];
            const m =
            (s.machineId && machines.find((mc) => mc.id === s.machineId)) ||
            machines.find((mc) => mc.kind === s.kind);
            await ctx.db.insert(operation).values({
              partId: created.id,
              machineId: m?.id ?? null,
              sequence: i,
              name: s.name,
              estMinutes: Math.round(s.estMinutes),
              autoAssigned: true,
            });
          }
        }
        return created;
      } catch (err) {
        if (err instanceof OnshapeAuthError) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: err.message });
        }
        throw err;
      }
    }),

  importAssembly: publicProcedure
    .input(
      z.object({
        documentId: z.string(),
        workspaceId: z.string().optional(),
        versionId: z.string().optional(),
        elementId: z.string(),
        name: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const def = await onshape.assembly({
          documentId: input.documentId,
          workspaceId: input.workspaceId,
          versionId: input.versionId,
          elementId: input.elementId,
        });

        const wOrV = input.workspaceId
          ? `w/${input.workspaceId}`
          : `v/${input.versionId}`;
        const baseUrl =
          process.env.ONSHAPE_BASE_URL ?? "https://cad.onshape.com";

        const [asmRow] = await ctx.db
          .insert(assembly)
          .values({
            name: input.name ?? "Imported Assembly",
            onshapeDocumentId: input.documentId,
            onshapeWorkspaceId: input.workspaceId,
            onshapeElementId: input.elementId,
            onshapeUrl: `${baseUrl}/documents/${input.documentId}/${wOrV}/e/${input.elementId}`,
            lastSyncedAt: new Date(),
          })
          .returning();

        // Recurse through sub-assemblies and group leaf parts by
        // (document, element, partId), summing quantities.
        const leafInstances = flattenAssemblyParts(def);
        const counts = new Map<
          string,
          {
            documentId: string;
            elementId: string;
            partId: string;
            workspaceId?: string;
            versionId?: string;
            isStandardContent: boolean;
            quantity: number;
          }
        >();
        for (const inst of leafInstances) {
          const did = inst.documentId ?? input.documentId;
          const eid = inst.elementId!;
          const partMeta = def.parts?.find(
            (p) =>
              p.partId === inst.partId &&
              (!p.elementId || p.elementId === eid),
          );
          if (isHiddenMaterial(partMeta?.material)) continue;

          const sameDoc = did === input.documentId;
          // For linked-doc parts Onshape pins them to a versionId at the
          // instance level; for same-doc parts we use the workspace we were
          // browsing.
          const workspaceId = sameDoc ? input.workspaceId : undefined;
          const versionId = sameDoc ? input.versionId : inst.versionId;

          const key = `${did}|${eid}|${inst.partId}`;
          const existing = counts.get(key);
          if (existing) {
            existing.quantity += 1;
          } else {
            counts.set(key, {
              documentId: did,
              elementId: eid,
              partId: inst.partId!,
              workspaceId,
              versionId,
              isStandardContent: Boolean(inst.isStandardContent),
              quantity: 1,
            });
          }
        }

        const machines = await ctx.db.select().from(machine);
        let imported = 0;
        const skipped: Array<{ partId: string; reason: string }> = [];
        for (const inst of counts.values()) {
          // Cross-document parts pinned via versionId; same-doc parts via the
          // workspace we were just browsing.
          let snap;
          try {
            snap = await fetchPartSnapshot({
              documentId: inst.documentId,
              workspaceId: inst.workspaceId,
              versionId: inst.versionId,
              elementId: inst.elementId,
              partId: inst.partId,
            });
          } catch (e) {
            skipped.push({
              partId: inst.partId,
              reason: (e as Error).message,
            });
            if (process.env.NODE_ENV !== "production") {
              console.error("Skipped part on assembly import:", inst, e);
            }
            continue;
          }

          // Hidden materials (Origin Cube, etc.) — final guard in case the
          // assembly summary didn't carry material into def.parts.
          if (snap.material && HIDDEN_MATERIALS.has(snap.material.toLowerCase().trim())) {
            skipped.push({ partId: inst.partId, reason: "hidden material" });
            continue;
          }

          const partType = inst.isStandardContent ? "cots" : "custom";
          // Assembly imports always go through detection — there's no
          // per-part user input here.
          const resolvedStockType = resolveStockType("auto", {
            material: snap.material,
            bboxX: snap.bbox?.x,
            bboxY: snap.bbox?.y,
            bboxZ: snap.bbox?.z,
            name: snap.name,
          });

          const [createdPart] = await ctx.db
            .insert(part)
            .values({
              name: snap.name,
              partNumber: snap.partNumber,
              type: partType,
              assemblyId: asmRow.id,
              quantity: inst.quantity,
              stockType: resolvedStockType,
              material: snap.material,
              massGrams: snap.massGrams ?? undefined,
              volumeMm3: snap.volumeMm3 ?? undefined,
              bboxXMm: snap.bbox?.x,
              bboxYMm: snap.bbox?.y,
              bboxZMm: snap.bbox?.z,
              onshapeDocumentId: snap.documentId,
              onshapePartId: snap.partId,
              onshapeElementId: snap.elementId,
              onshapeVersionId: snap.versionId ?? null,
              onshapeMicroversionId: snap.microversionId,
              onshapeUrl: snap.url,
              thumbnailUrl: snap.thumbnailUrl,
              status: "ready_to_make",
              lastSyncedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: part.partNumber,
              set: {
                assemblyId: asmRow.id,
                quantity: inst.quantity,
                stockType: resolvedStockType,
                lastSyncedAt: new Date(),
                updatedAt: new Date(),
              },
            })
            .returning();

          await ctx.db.insert(partRevision).values({
            partId: createdPart.id,
            onshapeVersionId: snap.versionId ?? null,
            onshapeMicroversionId: snap.microversionId,
            versionLabel: "v1",
            massGrams: snap.massGrams ?? undefined,
            volumeMm3: snap.volumeMm3 ?? undefined,
            changeSummary: "Imported from assembly",
          });

          if (partType === "custom") {
            const existingOps = await ctx.db
              .select()
              .from(operation)
              .where(eq(operation.partId, createdPart.id));
            if (existingOps.length === 0) {
              const steps = await loadTemplateSteps(
                ctx.db,
                createdPart.stockType,
              );
              for (let i = 0; i < steps.length; i++) {
                const s = steps[i];
                const m =
            (s.machineId && machines.find((mc) => mc.id === s.machineId)) ||
            machines.find((mc) => mc.kind === s.kind);
                await ctx.db.insert(operation).values({
                  partId: createdPart.id,
                  machineId: m?.id ?? null,
                  sequence: i,
                  name: s.name,
                  estMinutes: Math.round(s.estMinutes),
                  autoAssigned: true,
                });
              }
            }
          }
          imported++;
        }
        return { assemblyId: asmRow.id, imported, skipped };
      } catch (err) {
        if (err instanceof OnshapeAuthError) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: err.message });
        }
        throw err;
      }
    }),

  syncRevision: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db.query.part.findFirst({
        where: eq(part.id, input.id),
      });
      if (
        !row ||
        !row.onshapePartId ||
        !row.onshapeDocumentId ||
        !row.onshapeElementId
      ) {
        throw new TRPCError({ code: "BAD_REQUEST" });
      }
      try {
        const snap = await fetchPartSnapshot({
          documentId: row.onshapeDocumentId,
          workspaceId: row.onshapeUrl?.includes("/w/")
            ? extractIdAfter(row.onshapeUrl, "/w/")
            : undefined,
          versionId: row.onshapeVersionId ?? undefined,
          elementId: row.onshapeElementId,
          partId: row.onshapePartId,
        });

        const changed =
          snap.microversionId &&
          snap.microversionId !== row.onshapeMicroversionId;

        if (changed) {
          await ctx.db
            .update(part)
            .set({
              designChanged: true,
              onshapeMicroversionId: snap.microversionId,
              massGrams: snap.massGrams ?? row.massGrams,
              volumeMm3: snap.volumeMm3 ?? row.volumeMm3,
              lastSyncedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(part.id, row.id));

          const existing = await ctx.db
            .select()
            .from(partRevision)
            .where(eq(partRevision.partId, row.id));
          await ctx.db.insert(partRevision).values({
            partId: row.id,
            onshapeVersionId: snap.versionId ?? null,
            onshapeMicroversionId: snap.microversionId,
            versionLabel: `v${existing.length + 1}`,
            massGrams: snap.massGrams ?? undefined,
            volumeMm3: snap.volumeMm3 ?? undefined,
            changeSummary: "Microversion bumped in Onshape",
            flagged: true,
          });
        } else {
          await ctx.db
            .update(part)
            .set({ lastSyncedAt: new Date() })
            .where(eq(part.id, row.id));
        }
        return {
          changed: Boolean(changed),
          microversionId: snap.microversionId,
        };
      } catch (err) {
        if (err instanceof OnshapeAuthError) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: err.message });
        }
        throw err;
      }
    }),

  acknowledgeRevision: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(part)
        .set({ designChanged: false, updatedAt: new Date() })
        .where(eq(part.id, input.id));
      return { ok: true };
    }),

  /**
   * Re-sync every Onshape-linked part (or a specific subset). Returns a
   * summary so the UI can toast aggregate results.
   */
  bulkSyncRevisions: publicProcedure
    .input(
      z
        .object({
          ids: z.array(z.string()).optional(),
        })
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      const baseRows = input?.ids?.length
        ? await ctx.db
            .select()
            .from(part)
            .where(inArray(part.id, input.ids))
        : await ctx.db.select().from(part);
      // Only Onshape-linked parts can be sync'd.
      const candidates = baseRows.filter(
        (p) =>
          p.onshapePartId && p.onshapeDocumentId && p.onshapeElementId,
      );

      let changed = 0;
      let unchanged = 0;
      const failed: Array<{ id: string; partNumber: string; error: string }> = [];
      const changedParts: Array<{ id: string; name: string; partNumber: string }> = [];

      for (const row of candidates) {
        try {
          const snap = await fetchPartSnapshot({
            documentId: row.onshapeDocumentId!,
            workspaceId: row.onshapeUrl?.includes("/w/")
              ? extractIdAfter(row.onshapeUrl, "/w/")
              : undefined,
            versionId: row.onshapeVersionId ?? undefined,
            elementId: row.onshapeElementId!,
            partId: row.onshapePartId!,
          });
          const isChanged =
            !!snap.microversionId &&
            snap.microversionId !== row.onshapeMicroversionId;
          if (isChanged) {
            await ctx.db
              .update(part)
              .set({
                designChanged: true,
                onshapeMicroversionId: snap.microversionId,
                massGrams: snap.massGrams ?? row.massGrams,
                volumeMm3: snap.volumeMm3 ?? row.volumeMm3,
                lastSyncedAt: new Date(),
                updatedAt: new Date(),
              })
              .where(eq(part.id, row.id));
            const existing = await ctx.db
              .select()
              .from(partRevision)
              .where(eq(partRevision.partId, row.id));
            await ctx.db.insert(partRevision).values({
              partId: row.id,
              onshapeVersionId: snap.versionId ?? null,
              onshapeMicroversionId: snap.microversionId,
              versionLabel: `v${existing.length + 1}`,
              massGrams: snap.massGrams ?? undefined,
              volumeMm3: snap.volumeMm3 ?? undefined,
              changeSummary: "Microversion bumped in Onshape (bulk sync)",
              flagged: true,
            });
            changed++;
            changedParts.push({
              id: row.id,
              name: row.name,
              partNumber: row.partNumber,
            });
          } else {
            await ctx.db
              .update(part)
              .set({ lastSyncedAt: new Date() })
              .where(eq(part.id, row.id));
            unchanged++;
          }
        } catch (err) {
          if (err instanceof OnshapeAuthError) {
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message: err.message,
            });
          }
          failed.push({
            id: row.id,
            partNumber: row.partNumber,
            error: (err as Error).message,
          });
        }
      }
      return {
        scanned: candidates.length,
        changed,
        unchanged,
        failed: failed.length,
        skipped: baseRows.length - candidates.length,
        changedParts,
        errors: failed,
      };
    }),

  // ── Operations / steps ───────────────────────────────────────────────────
  addStep: publicProcedure
    .input(
      z.object({
        partId: z.string(),
        name: z.string().min(1),
        machineId: z.string().nullable().optional(),
        estMinutes: z.number().int().min(0).optional(),
        notes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const last = await ctx.db
        .select({ s: operation.sequence })
        .from(operation)
        .where(eq(operation.partId, input.partId))
        .orderBy(desc(operation.sequence))
        .limit(1);
      const nextSeq = last[0] ? last[0].s + 1 : 0;
      await ctx.db.insert(operation).values({
        partId: input.partId,
        machineId: input.machineId ?? null,
        sequence: nextSeq,
        name: input.name,
        estMinutes: input.estMinutes,
        notes: input.notes,
        autoAssigned: false,
      });
      await recomputePartStatus(ctx.db, input.partId);
      return { ok: true };
    }),

  reassignStep: publicProcedure
    .input(z.object({ stepId: z.string(), machineId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(operation)
        .set({ machineId: input.machineId, autoAssigned: false })
        .where(eq(operation.id, input.stepId));
      return { ok: true };
    }),

  setStepStatus: publicProcedure
    .input(z.object({ stepId: z.string(), status: z.enum(STEP_STATUSES) }))
    .mutation(async ({ ctx, input }) => {
      const patch: Record<string, unknown> = { status: input.status };
      if (input.status === "in_progress") patch.startedAt = new Date();
      if (input.status === "complete") patch.completedAt = new Date();
      await ctx.db
        .update(operation)
        .set(patch)
        .where(eq(operation.id, input.stepId));
      // Roll the part's overall status forward (or back) to match.
      const op = await ctx.db.query.operation.findFirst({
        where: eq(operation.id, input.stepId),
      });
      if (op) await recomputePartStatus(ctx.db, op.partId);
      return { ok: true };
    }),

  /**
   * Advance the part one step in its workflow, picking the right action by
   * inspecting the current state of the operation list:
   *   - in_progress step exists → mark it complete
   *   - else first not_started/in_queue step → set to in_progress
   *   - else all complete → no-op (caller should mark as on_robot manually)
   */
  advanceStep: publicProcedure
    .input(z.object({ partId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const ops = await ctx.db
        .select()
        .from(operation)
        .where(eq(operation.partId, input.partId))
        .orderBy(asc(operation.sequence));
      if (ops.length === 0) {
        return { ok: false, reason: "no_steps" as const };
      }
      const inProgress = ops.find((o) => o.status === "in_progress");
      if (inProgress) {
        await ctx.db
          .update(operation)
          .set({ status: "complete", completedAt: new Date() })
          .where(eq(operation.id, inProgress.id));
        await recomputePartStatus(ctx.db, input.partId);
        return {
          ok: true,
          action: "completed" as const,
          stepName: inProgress.name,
        };
      }
      const nextUp = ops.find(
        (o) => o.status === "not_started" || o.status === "in_queue",
      );
      if (nextUp) {
        await ctx.db
          .update(operation)
          .set({ status: "in_progress", startedAt: new Date() })
          .where(eq(operation.id, nextUp.id));
        await recomputePartStatus(ctx.db, input.partId);
        return {
          ok: true,
          action: "started" as const,
          stepName: nextUp.name,
        };
      }
      return { ok: false, reason: "all_complete" as const };
    }),

  setStepActuals: publicProcedure
    .input(
      z.object({ stepId: z.string(), actualMinutes: z.number().int().min(0) }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(operation)
        .set({ actualMinutes: input.actualMinutes })
        .where(eq(operation.id, input.stepId));
      return { ok: true };
    }),

  setStepEstimate: publicProcedure
    .input(z.object({ stepId: z.string(), estMinutes: z.number().int().min(0) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(operation)
        .set({ estMinutes: input.estMinutes })
        .where(eq(operation.id, input.stepId));
      return { ok: true };
    }),

  removeStep: publicProcedure
    .input(z.object({ stepId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const op = await ctx.db.query.operation.findFirst({
        where: eq(operation.id, input.stepId),
      });
      await ctx.db.delete(operation).where(eq(operation.id, input.stepId));
      if (op) await recomputePartStatus(ctx.db, op.partId);
      return { ok: true };
    }),

  estimateForStep: publicProcedure
    .input(z.object({ stepId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const op = await ctx.db.query.operation.findFirst({
        where: eq(operation.id, input.stepId),
        with: { part: true, machine: true },
      });
      if (!op || !op.machine || !op.part)
        throw new TRPCError({ code: "BAD_REQUEST" });
      const mins = estimateMinutes(
        op.machine.kind,
        {
          x: op.part.bboxXMm ?? 100,
          y: op.part.bboxYMm ?? 100,
          z: op.part.bboxZMm ?? 10,
        },
        op.part.material,
      );
      await ctx.db
        .update(operation)
        .set({ estMinutes: mins })
        .where(eq(operation.id, input.stepId));
      return { estMinutes: mins };
    }),

  // ── Attachments ──────────────────────────────────────────────────────────
  addAttachment: publicProcedure
    .input(
      z.object({
        partId: z.string().optional(),
        operationId: z.string().optional(),
        fileName: z.string(),
        fileKind: z.enum([
          "gcode",
          "nc",
          "dxf",
          "svg",
          "stl",
          "step",
          "pdf",
          "other",
        ]),
        sizeBytes: z.number().int().min(0),
        url: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db.insert(attachment).values({
        partId: input.partId ?? null,
        operationId: input.operationId ?? null,
        fileName: input.fileName,
        fileKind: input.fileKind,
        sizeBytes: input.sizeBytes,
        url: input.url,
      });
      return { ok: true };
    }),

  removeAttachment: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(attachment).where(eq(attachment.id, input.id));
      return { ok: true };
    }),

  groupAsBatch: publicProcedure
    .input(z.object({ ids: z.array(z.string()).min(1), batchKey: z.string() }))
    .mutation(async ({ ctx, input }) => {
      for (const id of input.ids) {
        await ctx.db
          .update(part)
          .set({ batchKey: input.batchKey })
          .where(eq(part.id, id));
      }
      return { ok: true };
    }),

  /**
   * List batches: every distinct batchKey on a part with summary counts.
   */
  listBatches: publicProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        batchKey: part.batchKey,
        count: sql<number>`COUNT(*)`,
        ready: sql<number>`SUM(CASE WHEN ${part.status} = 'ready_to_make' THEN 1 ELSE 0 END)`,
        inProduction: sql<number>`SUM(CASE WHEN ${part.status} = 'in_production' THEN 1 ELSE 0 END)`,
        done: sql<number>`SUM(CASE WHEN ${part.status} IN ('done','on_robot') THEN 1 ELSE 0 END)`,
      })
      .from(part)
      .where(sql`${part.batchKey} IS NOT NULL AND ${part.batchKey} != ''`)
      .groupBy(part.batchKey);
    return rows.map((r) => ({
      batchKey: r.batchKey!,
      count: Number(r.count),
      ready: Number(r.ready),
      inProduction: Number(r.inProduction),
      done: Number(r.done),
    }));
  }),

  /**
   * Start manufacturing on every part in the batch — queues each part's
   * first non-complete operation.
   */
  startBatch: publicProcedure
    .input(z.object({ batchKey: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const parts = await ctx.db
        .select()
        .from(part)
        .where(eq(part.batchKey, input.batchKey));
      if (parts.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No parts in this batch",
        });
      }
      let queued = 0;
      let alreadyDone = 0;
      for (const p of parts) {
        if (p.type === "cots") continue;
        const ops = await ctx.db
          .select()
          .from(operation)
          .where(eq(operation.partId, p.id))
          .orderBy(asc(operation.sequence));
        const firstPending = ops.find((o) => o.status !== "complete");
        if (!firstPending) {
          alreadyDone++;
          continue;
        }
        if (firstPending.status === "not_started") {
          await ctx.db
            .update(operation)
            .set({ status: "in_queue" })
            .where(eq(operation.id, firstPending.id));
        }
        await recomputePartStatus(ctx.db, p.id);
        queued++;
      }
      return { queued, alreadyDone, total: parts.length };
    }),
});

function extractIdAfter(url: string, marker: string) {
  const idx = url.indexOf(marker);
  if (idx === -1) return undefined;
  const tail = url.slice(idx + marker.length);
  const next = tail.split(/[/?#]/)[0];
  return next || undefined;
}
