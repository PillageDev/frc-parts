import { sql } from "drizzle-orm";
import { router, publicProcedure } from "../init";
import { operation, part } from "@/lib/db/schema";

export const dashboardRouter = router({
  summary: publicProcedure.query(async ({ ctx }) => {
    const counts = await ctx.db
      .select({
        total: sql<number>`COUNT(*)`,
        blocking: sql<number>`SUM(CASE WHEN ${part.priority}='blocking' THEN 1 ELSE 0 END)`,
        cots: sql<number>`SUM(CASE WHEN ${part.type}='cots' THEN 1 ELSE 0 END)`,
        custom: sql<number>`SUM(CASE WHEN ${part.type}='custom' THEN 1 ELSE 0 END)`,
        onRobot: sql<number>`SUM(CASE WHEN ${part.status}='on_robot' THEN 1 ELSE 0 END)`,
        inProduction: sql<number>`SUM(CASE WHEN ${part.status}='in_production' THEN 1 ELSE 0 END)`,
        ready: sql<number>`SUM(CASE WHEN ${part.status}='ready_to_make' THEN 1 ELSE 0 END)`,
        done: sql<number>`SUM(CASE WHEN ${part.status}='done' THEN 1 ELSE 0 END)`,
      })
      .from(part);

    const queueSizes = await ctx.db
      .select({
        machineId: operation.machineId,
        queued: sql<number>`SUM(CASE WHEN ${operation.status} IN ('not_started','in_queue') THEN 1 ELSE 0 END)`,
      })
      .from(operation)
      .groupBy(operation.machineId);

    return {
      counts: counts[0],
      queueSizes,
    };
  }),
});
