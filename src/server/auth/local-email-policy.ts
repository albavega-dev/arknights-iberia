type Environment = Readonly<Record<string, string | undefined>>;

export function localEmailEnabled(env: Environment): boolean {
  const flag = env.AUTH_LOCAL_EMAIL_ENABLED;
  if (flag === undefined || flag === "false") return false;
  if (flag !== "true") throw new Error("Invalid local email configuration");
  if (
    env.NODE_ENV !== "development" ||
    env.BETTER_AUTH_URL !== "http://localhost:3000" ||
    env.DB_CONNECTION_MODE !== "local" ||
    env.DB_HOST !== "127.0.0.1" ||
    (env.DB_PORT !== undefined && env.DB_PORT !== "5432") ||
    (env.DB_TLS_MODE !== undefined && env.DB_TLS_MODE !== "disable")
  ) {
    throw new Error("Local email authentication is not allowed in this environment");
  }
  return true;
}

export function localResetTokenTtl(env: Environment): number {
  const value = env.AUTH_LOCAL_RESET_TTL_SECONDS;
  if (value === undefined || value === "") return 3600;
  if (!/^\d+$/.test(value)) throw new Error("Invalid local reset token TTL");
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 5 || seconds > 3600) {
    throw new Error("Invalid local reset token TTL");
  }
  return seconds;
}
