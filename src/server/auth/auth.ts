import "server-only";

import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { getDatabase } from "../db/client";
import * as schema from "../db/auth-schema";
import { sendLocalAuthEmail } from "./local-email";
import { localEmailEnabled, localResetTokenTtl } from "./local-email-policy";
import { readLocalSocialProviders } from "./local-social-policy";
import { authOptions } from "./options";
import { accountManagementPaths, isRecentSession } from "./account-management-policy";

// Constructed on demand: builds do not need a runtime secret or database connection.
export function createAuth() {
  const secret = process.env.BETTER_AUTH_SECRET;
  const baseURL = process.env.BETTER_AUTH_URL;
  if (!secret || secret.length < 32 || !baseURL) {
    throw new Error("Authentication is not configured");
  }
  let url: URL;
  try { url = new URL(baseURL); }
  catch { throw new Error("Authentication URL is not allowed"); }
  if ((url.protocol !== "https:" && baseURL !== "http://localhost:3000") ||
      url.username || url.password || url.search || url.hash) {
    throw new Error("Authentication URL is not allowed");
  }
  const emailEnabled = localEmailEnabled(process.env);
  return betterAuth({
    ...authOptions,
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
          if (!accountManagementPaths.has(ctx.path)) return;
          // Enforce at Better Auth's endpoint boundary, including direct HTTP calls.
          const current = await getSessionFromCtx(ctx);
          if (!current?.session) throw new APIError("UNAUTHORIZED");
          if (!isRecentSession(current.session.createdAt)) {
            throw new APIError("FORBIDDEN", { message: "Session is not fresh" });
          }
      }),
    },
    socialProviders: readLocalSocialProviders(process.env),
    emailAndPassword: {
      enabled: emailEnabled,
      requireEmailVerification: true,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: emailEnabled ? localResetTokenTtl(process.env) : 3600,
      sendResetPassword: emailEnabled
        ? async ({ user, url }: { user: { email: string }; url: string }) => {
          await sendLocalAuthEmail(user.email, "Restablecer contraseña", url);
        }
        : undefined,
    },
    emailVerification: emailEnabled ? {
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
      sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => {
        await sendLocalAuthEmail(user.email, "Verificar correo", url);
      },
    } : undefined,
    database: drizzleAdapter(getDatabase(), { provider: "pg", schema }),
    secret,
    baseURL,
  });
}

let auth: ReturnType<typeof createAuth> | undefined;

export function getAuth() {
  auth ??= createAuth();
  return auth;
}
