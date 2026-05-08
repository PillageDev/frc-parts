import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import { auth } from "@/lib/auth/server";
import { db } from "@/lib/db/client";

export type Context = {
  db: typeof db;
  session: Awaited<ReturnType<typeof auth.api.getSession>> | null;
  headers: Headers;
};

export async function createContext(opts: { headers: Headers }): Promise<Context> {
  const session = await auth.api
    .getSession({ headers: opts.headers })
    .catch(() => null);
  return { db, session, headers: opts.headers };
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError:
          error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  return next({ ctx: { ...ctx, user: ctx.session.user } });
});
