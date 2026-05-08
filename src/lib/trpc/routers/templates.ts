import { z } from "zod";
import { asc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../init";
import type { db as DbInstance } from "@/lib/db/client";
import {
  machine,
  routeTemplate,
  routeTemplateStep,
  type MachineKind,
} from "@/lib/db/schema";

const stepSchema = z.object({
  name: z.string().min(1).max(120),
  machineId: z.string().nullable(),
  estMinutes: z.number().int().min(0).max(60 * 24 * 30),
});

export const templatesRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    const templates = await ctx.db
      .select()
      .from(routeTemplate)
      .orderBy(asc(routeTemplate.sortOrder), asc(routeTemplate.label));

    const steps = await ctx.db
      .select()
      .from(routeTemplateStep)
      .orderBy(asc(routeTemplateStep.sequence));

    return templates.map((t) => ({
      ...t,
      steps: steps.filter((s) => s.templateId === t.id),
    }));
  }),

  byId: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const t = await ctx.db.query.routeTemplate.findFirst({
        where: eq(routeTemplate.id, input.id),
      });
      if (!t) throw new TRPCError({ code: "NOT_FOUND" });
      const steps = await ctx.db
        .select()
        .from(routeTemplateStep)
        .where(eq(routeTemplateStep.templateId, t.id))
        .orderBy(asc(routeTemplateStep.sequence));
      return { ...t, steps };
    }),

  create: publicProcedure
    .input(
      z.object({
        key: z
          .string()
          .min(1)
          .max(40)
          .regex(
            /^[a-z0-9][a-z0-9_-]*$/i,
            "Use letters, numbers, dashes, underscores",
          ),
        label: z.string().min(1).max(80),
        description: z.string().optional(),
        steps: z.array(stepSchema).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const exists = await ctx.db.query.routeTemplate.findFirst({
        where: eq(routeTemplate.key, input.key.toLowerCase()),
      });
      if (exists) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `A template with key "${input.key}" already exists.`,
        });
      }
      const max = await ctx.db
        .select({ m: sql<number>`MAX(${routeTemplate.sortOrder})` })
        .from(routeTemplate);
      const nextOrder = Number(max[0]?.m ?? 0) + 10;

      const [created] = await ctx.db
        .insert(routeTemplate)
        .values({
          key: input.key.toLowerCase(),
          label: input.label.trim(),
          description: input.description?.trim() || null,
          isBuiltin: false,
          isAutoDetectable: false,
          sortOrder: nextOrder,
        })
        .returning();

      for (let i = 0; i < input.steps.length; i++) {
        const s = input.steps[i];
        const kind = await resolveMachineKind(ctx.db, s.machineId);
        await ctx.db.insert(routeTemplateStep).values({
          templateId: created.id,
          sequence: i,
          name: s.name,
          machineId: s.machineId,
          machineKind: kind,
          estMinutes: s.estMinutes,
        });
      }
      return created;
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        label: z.string().min(1).max(80).optional(),
        description: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const patch: Record<string, unknown> = {};
      if (input.label !== undefined) patch.label = input.label.trim();
      if (input.description !== undefined)
        patch.description = input.description?.trim() || null;
      if (Object.keys(patch).length > 0) {
        await ctx.db
          .update(routeTemplate)
          .set(patch)
          .where(eq(routeTemplate.id, input.id));
      }
      return { ok: true };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const t = await ctx.db.query.routeTemplate.findFirst({
        where: eq(routeTemplate.id, input.id),
      });
      if (!t) throw new TRPCError({ code: "NOT_FOUND" });
      if (t.isBuiltin) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Built-in templates can't be deleted, only edited.",
        });
      }
      await ctx.db
        .delete(routeTemplate)
        .where(eq(routeTemplate.id, input.id));
      return { ok: true };
    }),

  /** Replace the full step list for a template. Atomic-ish (delete + insert). */
  setSteps: publicProcedure
    .input(
      z.object({
        id: z.string(),
        steps: z.array(stepSchema),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const t = await ctx.db.query.routeTemplate.findFirst({
        where: eq(routeTemplate.id, input.id),
      });
      if (!t) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.db
        .delete(routeTemplateStep)
        .where(eq(routeTemplateStep.templateId, t.id));
      for (let i = 0; i < input.steps.length; i++) {
        const s = input.steps[i];
        const kind = await resolveMachineKind(ctx.db, s.machineId);
        await ctx.db.insert(routeTemplateStep).values({
          templateId: t.id,
          sequence: i,
          name: s.name,
          machineId: s.machineId,
          machineKind: kind,
          estMinutes: s.estMinutes,
        });
      }
      return { ok: true };
    }),
});

/**
 * Look up the machine's kind by id. Falls back to "bench" for unassigned
 * steps so the column's enum constraint stays satisfied.
 */
async function resolveMachineKind(
  db: typeof DbInstance,
  machineId: string | null,
): Promise<MachineKind> {
  if (!machineId) return "bench";
  const row = await db.query.machine.findFirst({
    where: eq(machine.id, machineId),
  });
  return row?.kind ?? "bench";
}
