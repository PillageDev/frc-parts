import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";

export const auth = betterAuth({
  baseURL:
    process.env.BETTER_AUTH_URL ??
    process.env.NEXT_PUBLIC_APP_URL ??
    "http://localhost:3000",
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        defaultValue: "designer",
        required: false,
        input: false,
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  trustedOrigins: ["http://localhost:3000"],
  // Stable, 64-char hex fallback so sessions survive dev restarts without
  // tripping better-auth's low-entropy warning. Production MUST override
  // BETTER_AUTH_SECRET via .env.local — generate with `openssl rand -hex 32`.
  secret:
    process.env.BETTER_AUTH_SECRET ??
    "fb7c8a92e6d34f15b2c0a48d9e7138fa5b62c89d4a103fe8d5b27c9a64f3e1b8",
});

export type Auth = typeof auth;
