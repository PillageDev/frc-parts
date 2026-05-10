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
import { detectStockType, loadTemplateSteps } from "@/lib/routing";
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
            autoAssigned: true,
            requireFile: s.requireFile,
            requireFileKind: s.requireFileKind,
            requireNote: s.requireNote,
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
          autoAssigned: true,
          requireFile: s.requireFile,
          requireFileKind: s.requireFileKind,
          requireNote: s.requireNote,
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

  /**
   * Parts already imported from a specific Onshape document. Powers the
   * Browse tab inside the in-Onshape sidebar so the user can see what's
   * already in the manager for the doc they're currently looking at.
   */
  byDocument: publicProcedure
    .input(z.object({ documentId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(part)
        .where(eq(part.onshapeDocumentId, input.documentId))
        .orderBy(desc(part.updatedAt));
    }),

  /**
   * Checks which Onshape parts in a given (document, element) tuple are
   * already imported into the manager. Returns one row per existing part
   * so the importer UI can flag duplicates and warn before re-importing.
   * Re-importing is destructive-ish — it triggers `onConflictDoUpdate` on
   * `partNumber` and bumps `lastSyncedAt` — so we want a confirmation.
   */
  checkDuplicates: publicProcedure
    .input(
      z.object({
        documentId: z.string().min(1),
        elementId: z.string().min(1),
        partIds: z.array(z.string()).default([]),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (input.partIds.length === 0) return [];
      return ctx.db
        .select({
          id: part.id,
          name: part.name,
          partNumber: part.partNumber,
          onshapePartId: part.onshapePartId,
          onshapeVersionName: part.onshapeVersionName,
          status: part.status,
          updatedAt: part.updatedAt,
        })
        .from(part)
        .where(
          and(
            eq(part.onshapeDocumentId, input.documentId),
            eq(part.onshapeElementId, input.elementId),
            inArray(part.onshapePartId, input.partIds),
          ),
        );
    }),

  /**
   * Lightweight document metadata (name, default workspace) for the
   * sidebar header. Falls back gracefully when Onshape can't be reached.
   */
  onshapeDocumentInfo: publicProcedure
    .input(z.object({ documentId: z.string().min(1) }))
    .query(async ({ input }) => {
      try {
        const doc = await onshape.getDocument(input.documentId);
        return { id: doc.id, name: doc.name };
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

  /**
   * Resolve an Onshape document URL into a versions list. We refuse to import
   * from live workspaces — every part must come from a named Version
   * (Onshape's immutable release primitive).
   */
  resolveOnshapeUrl: publicProcedure
    .input(z.object({ url: z.string() }))
    .query(async ({ input }) => {
      try {
        const ref = parseOnshapeUrl(input.url);
        const versions = await onshape.listVersions(ref.documentId);
        // Onshape always includes a synthetic "Start" version at index 0.
        // Hide it — there's nothing useful to import there.
        const usable = versions.filter(
          (v) => v.name !== "Start" && v.name !== "Initial",
        );
        return { ref, versions: usable };
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
   * List the importable Part Studios in a specific document version.
   */
  listVersionElements: publicProcedure
    .input(
      z.object({
        documentId: z.string(),
        versionId: z.string(),
      }),
    )
    .query(async ({ input }) => {
      try {
        const all = await onshape.listElements({
          documentId: input.documentId,
          versionId: input.versionId,
        });
        return all.filter((e) => IMPORTABLE_ELEMENT_TYPES.has(e.elementType));
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
        versionName: z.string().optional(),
        drawing: drawingSchema,
        vendor: z.string().optional(),
        vendorPartNumber: z.string().optional(),
        unitPriceCents: z.number().int().min(0).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Hard-gate: workspace imports are blocked. Every part has to come from
      // a named Onshape Version so it's pinned/immutable.
      if (!input.versionId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Pick a released Version of the document — workspace imports aren't allowed.",
        });
      }
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
            onshapeVersionName: input.versionName ?? null,
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
              autoAssigned: true,
              requireFile: s.requireFile,
              requireFileKind: s.requireFileKind,
              requireNote: s.requireNote,
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
                  autoAssigned: true,
                  requireFile: s.requireFile,
                  requireFileKind: s.requireFileKind,
                  requireNote: s.requireNote,
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

  /**
   * Look up the human-readable version name for any parts that have an
   * onshape_version_id set but a null onshape_version_name (parts imported
   * before we started saving the name). Groups by document so we hit
   * Onshape once per doc rather than once per part.
   */
  backfillVersionNames: publicProcedure.mutation(async ({ ctx }) => {
    const candidates = await ctx.db
      .select()
      .from(part)
      .where(
        sql`${part.onshapeVersionId} IS NOT NULL AND ${part.onshapeVersionName} IS NULL AND ${part.onshapeDocumentId} IS NOT NULL`,
      );
    if (candidates.length === 0) {
      return { updated: 0, scanned: 0 };
    }

    // Group by documentId so we list each document's versions only once.
    const byDoc = new Map<string, typeof candidates>();
    for (const p of candidates) {
      const did = p.onshapeDocumentId!;
      const arr = byDoc.get(did) ?? [];
      arr.push(p);
      byDoc.set(did, arr);
    }

    let updated = 0;
    for (const [docId, parts] of byDoc.entries()) {
      let versions: Awaited<ReturnType<typeof onshape.listVersions>>;
      try {
        versions = await onshape.listVersions(docId);
      } catch {
        continue;
      }
      const byId = new Map(versions.map((v) => [v.id, v.name]));
      for (const p of parts) {
        const name = byId.get(p.onshapeVersionId!);
        if (name) {
          await ctx.db
            .update(part)
            .set({ onshapeVersionName: name })
            .where(eq(part.id, p.id));
          updated++;
        }
      }
    }
    return { updated, scanned: candidates.length };
  }),

  /** List versions of an Onshape document so the UI can pick one. */
  documentVersions: publicProcedure
    .input(z.object({ documentId: z.string() }))
    .query(async ({ input }) => {
      try {
        const versions = await onshape.listVersions(input.documentId);
        return versions.filter(
          (v) => v.name !== "Start" && v.name !== "Initial",
        );
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

  /**
   * Re-pin one part to a different Onshape Version. Re-fetches the snapshot
   * (mass / volume / bbox / thumbnail) from the new version, writes a
   * partRevision row so history is preserved, and updates the live part.
   */
  updateToVersion: publicProcedure
    .input(
      z.object({
        id: z.string(),
        versionId: z.string(),
        versionName: z.string(),
      }),
    )
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
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Part isn't linked to Onshape.",
        });
      }
      try {
        const snap = await fetchPartSnapshot({
          documentId: row.onshapeDocumentId,
          versionId: input.versionId,
          elementId: row.onshapeElementId,
          partId: row.onshapePartId,
        });
        await ctx.db
          .update(part)
          .set({
            onshapeVersionId: input.versionId,
            onshapeVersionName: input.versionName,
            onshapeMicroversionId: snap.microversionId,
            onshapeUrl: snap.url,
            thumbnailUrl: snap.thumbnailUrl,
            massGrams: snap.massGrams ?? row.massGrams,
            volumeMm3: snap.volumeMm3 ?? row.volumeMm3,
            bboxXMm: snap.bbox?.x ?? row.bboxXMm,
            bboxYMm: snap.bbox?.y ?? row.bboxYMm,
            bboxZMm: snap.bbox?.z ?? row.bboxZMm,
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
          onshapeVersionId: input.versionId,
          onshapeMicroversionId: snap.microversionId,
          versionLabel: `v${existing.length + 1}`,
          massGrams: snap.massGrams ?? undefined,
          volumeMm3: snap.volumeMm3 ?? undefined,
          changeSummary: `Re-pinned to Onshape version "${input.versionName}"`,
          flagged: false,
        });
        return { ok: true, versionName: input.versionName };
      } catch (err) {
        if (err instanceof OnshapeAuthError) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: err.message });
        }
        throw err;
      }
    }),

  /**
   * Re-pin many parts to a different Onshape Version. All parts in `ids`
   * must share the same `onshapeDocumentId` (the version is per-document).
   */
  bulkUpdateToVersion: publicProcedure
    .input(
      z.object({
        ids: z.array(z.string()).min(1),
        versionId: z.string(),
        versionName: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(part)
        .where(inArray(part.id, input.ids));
      let updated = 0;
      const failed: Array<{ id: string; partNumber: string; error: string }> =
        [];
      for (const row of rows) {
        if (
          !row.onshapePartId ||
          !row.onshapeDocumentId ||
          !row.onshapeElementId
        ) {
          failed.push({
            id: row.id,
            partNumber: row.partNumber,
            error: "Not linked to Onshape",
          });
          continue;
        }
        try {
          const snap = await fetchPartSnapshot({
            documentId: row.onshapeDocumentId,
            versionId: input.versionId,
            elementId: row.onshapeElementId,
            partId: row.onshapePartId,
          });
          await ctx.db
            .update(part)
            .set({
              onshapeVersionId: input.versionId,
              onshapeVersionName: input.versionName,
              onshapeMicroversionId: snap.microversionId,
              onshapeUrl: snap.url,
              thumbnailUrl: snap.thumbnailUrl,
              massGrams: snap.massGrams ?? row.massGrams,
              volumeMm3: snap.volumeMm3 ?? row.volumeMm3,
              bboxXMm: snap.bbox?.x ?? row.bboxXMm,
              bboxYMm: snap.bbox?.y ?? row.bboxYMm,
              bboxZMm: snap.bbox?.z ?? row.bboxZMm,
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
            onshapeVersionId: input.versionId,
            onshapeMicroversionId: snap.microversionId,
            versionLabel: `v${existing.length + 1}`,
            massGrams: snap.massGrams ?? undefined,
            volumeMm3: snap.volumeMm3 ?? undefined,
            changeSummary: `Bulk re-pinned to Onshape version "${input.versionName}"`,
            flagged: false,
          });
          updated++;
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
      return { updated, failed: failed.length, errors: failed };
    }),

  // ── Operations / steps ───────────────────────────────────────────────────
  addStep: publicProcedure
    .input(
      z.object({
        partId: z.string(),
        name: z.string().min(1),
        machineId: z.string().nullable().optional(),
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
      // Validate template-level requirements before allowing the step to be
      // marked complete. Other transitions are unrestricted.
      if (input.status === "complete") {
        const op = await ctx.db.query.operation.findFirst({
          where: eq(operation.id, input.stepId),
          with: {
            part: { with: { attachments: true } },
            attachments: true,
          },
        });
        if (!op) throw new TRPCError({ code: "NOT_FOUND" });
        if (op.requireFile) {
          const allFiles = [
            ...(op.attachments ?? []),
            ...(op.part?.attachments ?? []),
          ];
          const ok = op.requireFileKind
            ? allFiles.some((a) => a.fileKind === op.requireFileKind)
            : allFiles.length > 0;
          if (!ok) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: op.requireFileKind
                ? `This step needs a .${op.requireFileKind} file attached before it can be marked complete.`
                : "Attach at least one file to this part before marking the step complete.",
            });
          }
        }
        if (op.requireNote && (!op.notes || op.notes.trim().length === 0)) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Add an operator note to this step before marking complete.",
          });
        }
      }

      const patch: Record<string, unknown> = { status: input.status };
      if (input.status === "in_progress") patch.startedAt = new Date();
      if (input.status === "complete") patch.completedAt = new Date();
      await ctx.db
        .update(operation)
        .set(patch)
        .where(eq(operation.id, input.stepId));
      // Roll the part's overall status forward (or back) to match.
      const op2 = await ctx.db.query.operation.findFirst({
        where: eq(operation.id, input.stepId),
      });
      if (op2) await recomputePartStatus(ctx.db, op2.partId);
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
   * Timeline data — every part with its operation timestamps so the UI can
   * render a Gantt-style bar per part. Returns parts that have at least one
   * non-zero timestamp OR are still open (not done/on_robot).
   */
  timeline: publicProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.query.part.findMany({
      with: {
        operations: {
          with: { machine: true },
          orderBy: asc(operation.sequence),
        },
      },
      orderBy: desc(part.createdAt),
    });
    return rows
      .map((p) => {
        const ops = p.operations.map((o) => ({
          id: o.id,
          name: o.name,
          status: o.status,
          machineName: o.machine?.name ?? null,
          startedAt: o.startedAt,
          completedAt: o.completedAt,
          actualMinutes: o.actualMinutes,
        }));
        const startedTimes = ops
          .map((o) => o.startedAt)
          .filter((d): d is Date => d != null)
          .map((d) => d.getTime());
        const completedTimes = ops
          .map((o) => o.completedAt)
          .filter((d): d is Date => d != null)
          .map((d) => d.getTime());
        const firstStartedAt = startedTimes.length
          ? new Date(Math.min(...startedTimes))
          : null;
        const lastCompletedAt = completedTimes.length
          ? new Date(Math.max(...completedTimes))
          : null;
        return {
          id: p.id,
          name: p.name,
          partNumber: p.partNumber,
          status: p.status,
          priority: p.priority,
          batchKey: p.batchKey,
          createdAt: p.createdAt,
          firstStartedAt,
          lastCompletedAt,
          operations: ops,
        };
      })
      .filter(
        (p) =>
          p.firstStartedAt !== null ||
          (p.status !== "done" && p.status !== "on_robot"),
      );
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
   * Start manufacturing on a list of parts (e.g. multi-select group on the
   * parts page). Queues each part's first non-complete operation.
   */
  bulkStartManufacturing: publicProcedure
    .input(z.object({ ids: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const parts = await ctx.db
        .select()
        .from(part)
        .where(inArray(part.id, input.ids));
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
