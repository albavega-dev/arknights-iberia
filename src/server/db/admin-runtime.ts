import { readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { TextDecoder } from "node:util";

type Environment = Record<string, string | undefined>;

export type AdminEnvPreflightCode =
  | "env-file-missing"
  | "env-file-encoding"
  | "env-file-newline"
  | "env-file-syntax"
  | "env-duplicate-key"
  | "env-required-missing"
  | "env-conflict"
  | "target-mismatch"
  | "role-mismatch";

export type AdminEnvPreflightResult =
  | { readonly ok: true; readonly values: Readonly<Record<string, string>> }
  | { readonly ok: false; readonly code: AdminEnvPreflightCode };

export function readAdminEnvFile(filePath: string): Record<string, string> {
  const resolved = resolve(filePath);
  let text: string;
  try {
    if (!statSync(resolved).isFile()) throw new Error("not-file");
    text = readFileSync(resolved, "utf8");
  } catch {
    throw new Error("Administrative env file is missing or invalid");
  }
  const values: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(line);
    if (!match) throw new Error("Administrative env file has invalid syntax");
    const [, key, value] = match;
    if (values[key] !== undefined) throw new Error("Administrative env file has duplicate keys");
    values[key] = value.trim().replace(/^(['"])(.*)\1$/u, "$2");
  }
  return values;
}

export function preflightAdminEnvFile(
  filePath: string,
  options: { readonly expectedDatabase: string; readonly expectedUser: string; readonly inheritedEnv?: Readonly<Record<string, string | undefined>> },
): AdminEnvPreflightResult {
  const resolved = resolve(filePath);
  let bytes: Buffer;
  let text: string;
  try { if (!statSync(resolved).isFile()) return { ok: false, code: "env-file-missing" }; } catch { return { ok: false, code: "env-file-missing" }; }
  try {
    bytes = readFileSync(resolved);
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { ok: false, code: "env-file-encoding" };
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, code: "env-file-encoding" };
  }
  if (text.includes("\\n")) return { ok: false, code: "env-file-newline" };
  let values: Record<string, string>;
  try {
    values = readAdminEnvFile(resolved);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return { ok: false, code: message.includes("duplicate") ? "env-duplicate-key" : "env-file-syntax" };
  }
  const required = ["DB_CONNECTION_MODE", "DB_HOST", "DB_PORT", "DB_TLS_MODE", "POSTGRES_DB", "MIGRATION_DB_USER", "MIGRATION_DB_EXPECTED_USER", "MIGRATION_DB_PASSWORD"];
  if (required.some((key) => !values[key]?.trim())) return { ok: false, code: "env-required-missing" };
  const inherited = options.inheritedEnv ?? process.env;
  const conflictKeys = ["DB_CONNECTION_MODE", "DB_HOST", "DB_PORT", "DB_TLS_MODE", "POSTGRES_DB", "MIGRATION_DB_USER", "MIGRATION_DB_EXPECTED_USER", "MIGRATION_DB_PASSWORD", "DATABASE_URL", "POSTGRES_URL", "PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGSERVICE", "PGSERVICEFILE", "PGOPTIONS"];
  if (conflictKeys.some((key) => inherited[key] !== undefined)) return { ok: false, code: "env-conflict" };
  if (values.POSTGRES_DB !== options.expectedDatabase || values.DB_CONNECTION_MODE !== "local" || values.DB_HOST !== "127.0.0.1" || values.DB_TLS_MODE !== "disable" || values.DB_PORT !== "5432") return { ok: false, code: "target-mismatch" };
  if (values.MIGRATION_DB_USER !== options.expectedUser || values.MIGRATION_DB_EXPECTED_USER !== options.expectedUser) return { ok: false, code: "role-mismatch" };
  return { ok: true, values };
}

export function loadAdminEnv(filePath: string | undefined, env: Environment = process.env): void {
  const selected = filePath ?? ".env";
  const values = readAdminEnvFile(selected);
  for (const key of Object.keys(values)) {
    if (env[key] !== undefined) throw new Error("Administrative env conflicts with process environment");
  }
  Object.assign(env, values);
}

export function adminEnvFileArgument(argv: readonly string[]): string | undefined {
  const matches = argv.filter((value) => value === "--env-file" || value.startsWith("--env-file="));
  if (matches.length > 1) throw new Error("Only one --env-file is allowed");
  const match = matches[0];
  if (!match) return undefined;
  if (match === "--env-file") {
    const index = argv.indexOf(match);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error("Missing --env-file value");
    return value;
  }
  const value = match.slice("--env-file=".length);
  if (!value) throw new Error("Missing --env-file value");
  return value;
}

export function loadAdminEnvironment(argv: readonly string[], env: Environment = process.env): void {
  loadAdminEnv(adminEnvFileArgument(argv), env);
}

export function assertAdministrativeTarget(
  env: Readonly<Record<string, string | undefined>>,
  expectedRole: "migration" | "app",
): void {
  const mode = env.DB_CONNECTION_MODE ?? "local";
  const user = expectedRole === "migration" ? env.MIGRATION_DB_USER : env.APP_DB_USER;
  if (mode === "remote") {
    if (env.DB_TLS_MODE !== "verify-full") throw new Error("Remote administrative TLS is not verify-full");
    if (!env.DB_HOST || env.DB_HOST.includes("-pooler.") || env.DB_HOST.includes("pooler")) {
      throw new Error("Remote migration target must use the direct endpoint");
    }
    const expectedRoleSetting = expectedRole === "migration" ? env.MIGRATION_DB_EXPECTED_USER : env.APP_DB_EXPECTED_USER;
    const allowedRoles = expectedRole === "migration"
      ? new Set(["arknights_migrator", "arknights_schema_migrator"])
      : new Set(["arknights_reader"]);
    if (!expectedRoleSetting || user !== expectedRoleSetting || !allowedRoles.has(expectedRoleSetting)) {
      throw new Error("Unexpected administrative database role");
    }
    if (env.POSTGRES_DB !== "neondb") throw new Error("Unexpected remote database");
    return;
  }
  if (mode !== "local" || (env.DB_HOST && env.DB_HOST !== "127.0.0.1")) {
    throw new Error("Unexpected database target");
  }
}

export function assertAbsoluteCertificatePath(filePath: string): string {
  if (!isAbsolute(filePath)) throw new Error("DB_SSL_ROOT_CERT must be an absolute path");
  try {
    if (!statSync(filePath).isFile()) throw new Error("not-file");
  } catch {
    throw new Error("DB_SSL_ROOT_CERT is missing or invalid");
  }
  return filePath;
}
