import { router } from "./init";
import { partsRouter } from "./routers/parts";
import { machinesRouter } from "./routers/machines";
import { dashboardRouter } from "./routers/dashboard";
import { assembliesRouter } from "./routers/assemblies";
import { foldersRouter } from "./routers/folders";
import { templatesRouter } from "./routers/templates";

export const appRouter = router({
  parts: partsRouter,
  machines: machinesRouter,
  dashboard: dashboardRouter,
  assemblies: assembliesRouter,
  folders: foldersRouter,
  templates: templatesRouter,
});

export type AppRouter = typeof appRouter;
