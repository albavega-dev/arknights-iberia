type Environment = Readonly<Record<string, string | undefined>>;

function enabled(env: Environment, flagName: string): boolean {
  const flag = env[flagName];
  if (flag === undefined || flag === "false") return false;
  if (flag !== "true") throw new Error("Invalid local OAuth configuration");
  if (
    env.NODE_ENV !== "development" ||
    env.BETTER_AUTH_URL !== "http://localhost:3000" ||
    env.DB_CONNECTION_MODE !== "local" ||
    env.DB_HOST !== "127.0.0.1" ||
    (env.DB_PORT !== undefined && env.DB_PORT !== "5432") ||
    (env.DB_TLS_MODE !== undefined && env.DB_TLS_MODE !== "disable")
  ) {
    throw new Error("Local OAuth is not allowed in this environment");
  }
  return true;
}

function credentials(env: Environment, idName: string, secretName: string) {
  const clientId = env[idName];
  const clientSecret = env[secretName];
  if (!clientId?.trim() || !clientSecret?.trim()) {
    throw new Error("Missing local OAuth credentials");
  }
  return { clientId, clientSecret };
}

export function readLocalSocialProviders(env: Environment) {
  const google = enabled(env, "AUTH_LOCAL_GOOGLE_ENABLED");
  const discord = enabled(env, "AUTH_LOCAL_DISCORD_ENABLED");
  return {
    ...(google ? { google: {
      ...credentials(env, "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"),
      disableSignUp: true,
      disableIdTokenSignIn: true,
      requireEmailVerification: true,
    } } : {}),
    ...(discord ? { discord: {
      ...credentials(env, "DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET"),
      disableSignUp: true,
      requireEmailVerification: true,
    } } : {}),
  };
}
