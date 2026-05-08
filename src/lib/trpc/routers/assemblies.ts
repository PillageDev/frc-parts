import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { router, publicProcedure } from "../init";
import { assembly, part } from "@/lib/db/schema";

export const assembliesRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        assembly,
        partCount: sql<number>`(SELECT COUNT(*) FROM ${part} WHERE ${part.assemblyId} = ${assembly.id})`,
        cotsCount: sql<number>`(SELECT COUNT(*) FROM ${part} WHERE ${part.assemblyId} = ${assembly.id} AND ${part.type}='cots')`,
        customCount: sql<number>`(SELECT COUNT(*) FROM ${part} WHERE ${part.assemblyId} = ${assembly.id} AND ${part.type}='custom')`,
      })
      .from(assembly)
      .orderBy(sql`${assembly.createdAt} DESC`);
  }),

  byId: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const asm = await ctx.db.query.assembly.findFirst({
        where: eq(assembly.id, input.id),
      });
      if (!asm) return null;
      const parts = await ctx.db
        .select()
        .from(part)
        .where(eq(part.assemblyId, asm.id))
        .orderBy(sql`${part.type} ASC, ${part.partNumber} ASC`);
      return { assembly: asm, parts };
    }),
});
