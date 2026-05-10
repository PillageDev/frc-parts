import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../init";
import {
  MACHINE_KINDS,
  machine,
  operation,
  part,
  STEP_STATUSES,
} from "@/lib/db/schema";

export const machinesRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        machine,
        queued: sql<number>`COALESCE(SUM(CASE WHEN ${operation.status} IN ('not_started','in_queue') THEN 1 ELSE 0 END), 0)`,
        active: sql<number>`COALESCE(SUM(CASE WHEN ${operation.status} = 'in_progress' THEN 1 ELSE 0 END), 0)`,
        done: sql<number>`COALESCE(SUM(CASE WHEN ${operation.status} = 'complete' THEN 1 ELSE 0 END), 0)`,
        pendingCount: sql<number>`COALESCE(SUM(CASE WHEN ${operation.status} IN ('not_started','in_queue','in_progress') THEN 1 ELSE 0 END), 0)`,
      })
      .from(machine)
      .leftJoin(operation, eq(operation.machineId, machine.id))
      .groupBy(machine.id)
      .orderBy(asc(machine.name));
    return rows;
  }),

  byId: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const m = await ctx.db.query.machine.findFirst({
        where: eq(machine.id, input.id),
      });
      if (!m) return null;
      const ops = await ctx.db
        .select({ op: operation, part })
        .from(operation)
        .innerJoin(part, eq(part.id, operation.partId))
        .where(eq(operation.machineId, m.id))
        .orderBy(
          sql`CASE ${part.priority}
            WHEN 'blocking' THEN 0
            WHEN 'high' THEN 1
            WHEN 'normal' THEN 2
            WHEN 'low' THEN 3
          END`,
          asc(operation.sequence),
        );
      return { machine: m, operations: ops };
    }),

  byKind: publicProcedure
    .input(z.object({ status: z.enum(STEP_STATUSES).optional() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select({ machine, op: operation, part })
        .from(machine)
        .leftJoin(operation, eq(operation.machineId, machine.id))
        .leftJoin(part, eq(part.id, operation.partId))
        .where(input?.status ? eq(operation.status, input.status) : undefined)
        .orderBy(asc(machine.name));
      return rows;
    }),

  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(80),
        kind: z.enum(MACHINE_KINDS),
        description: z.string().nullable().optional(),
        capacityNote: z.string().nullable().optional(),
        costPerHourCents: z.number().int().min(0).default(0),
        isOutsource: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [created] = await ctx.db
        .insert(machine)
        .values({
          name: input.name.trim(),
          kind: input.kind,
          description: input.description?.trim() || null,
          capacityNote: input.capacityNote?.trim() || null,
          costPerHourCents: input.costPerHourCents,
          isOutsource: input.isOutsource,
        })
        .returning();
      return created;
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(80).optional(),
        kind: z.enum(MACHINE_KINDS).optional(),
        description: z.string().nullable().optional(),
        capacityNote: z.string().nullable().optional(),
        costPerHourCents: z.number().int().min(0).optional(),
        isOutsource: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...rest } = input;
      const patch: Record<string, unknown> = {};
      if (rest.name !== undefined) patch.name = rest.name.trim();
      if (rest.kind !== undefined) patch.kind = rest.kind;
      if (rest.description !== undefined)
        patch.description = rest.description?.trim() || null;
      if (rest.capacityNote !== undefined)
        patch.capacityNote = rest.capacityNote?.trim() || null;
      if (rest.costPerHourCents !== undefined)
        patch.costPerHourCents = rest.costPerHourCents;
      if (rest.isOutsource !== undefined) patch.isOutsource = rest.isOutsource;
      if (Object.keys(patch).length > 0) {
        await ctx.db.update(machine).set(patch).where(eq(machine.id, id));
      }
      return { ok: true };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const m = await ctx.db.query.machine.findFirst({
        where: eq(machine.id, input.id),
      });
      if (!m) throw new TRPCError({ code: "NOT_FOUND" });
      // Operations referencing this machine get machineId nulled by the
      // ON DELETE SET NULL FK. Same for route-template steps. Operators can
      // re-route or reassign manually after.
      await ctx.db.delete(machine).where(eq(machine.id, input.id));
      return { ok: true };
    }),
});
