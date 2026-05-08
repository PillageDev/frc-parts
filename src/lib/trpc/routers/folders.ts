import { z } from "zod";
import { asc, eq, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure } from "../init";
import { folder, part } from "@/lib/db/schema";

export const foldersRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    // Two queries is more robust than a correlated subquery for this — the
    // earlier `SELECT COUNT(*) FROM part WHERE folder_id = folder.id`
    // template stopped reflecting newly-assigned parts in some cases.
    const folders = await ctx.db
      .select()
      .from(folder)
      .orderBy(asc(folder.sortOrder), asc(folder.name));

    const counts = await ctx.db
      .select({
        folderId: part.folderId,
        count: sql<number>`COUNT(*)`,
      })
      .from(part)
      .groupBy(part.folderId);

    const byFolderId = new Map<string, number>();
    let unassignedCount = 0;
    for (const c of counts) {
      const n = Number(c.count);
      if (c.folderId == null) unassignedCount = n;
      else byFolderId.set(c.folderId, n);
    }

    return {
      folders: folders.map((f) => ({
        folder: f,
        partCount: byFolderId.get(f.id) ?? 0,
      })),
      unassignedCount,
    };
  }),

  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1).max(80),
        description: z.string().optional(),
        color: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [created] = await ctx.db
        .insert(folder)
        .values({
          name: input.name.trim(),
          description: input.description?.trim() || null,
          color: input.color || null,
        })
        .returning();
      return created;
    }),

  rename: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(80),
        description: z.string().optional(),
        color: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(folder)
        .set({
          name: input.name.trim(),
          description: input.description?.trim() || null,
          color: input.color || null,
        })
        .where(eq(folder.id, input.id));
      return { ok: true };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Detach parts; do not cascade-delete them.
      await ctx.db
        .update(part)
        .set({ folderId: null })
        .where(eq(part.folderId, input.id));
      await ctx.db.delete(folder).where(eq(folder.id, input.id));
      return { ok: true };
    }),

  byId: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const f = await ctx.db.query.folder.findFirst({
        where: eq(folder.id, input.id),
      });
      if (!f) throw new TRPCError({ code: "NOT_FOUND" });
      return f;
    }),
});
