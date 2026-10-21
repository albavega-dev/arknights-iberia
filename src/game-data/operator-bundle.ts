import { createHash } from "node:crypto";
import { validateBiography, type OperatorBiography } from "./operator-biography";
import type { OperatorClass, OperatorRecord } from "./operators";

export const operatorBundleContractVersion = "1" as const;
const classes = new Set<OperatorClass>(["Guard", "Vanguard", "Defender", "Sniper", "Caster", "Medic", "Supporter", "Specialist"]);
const regions = new Set(["en", "cn"] as const);
const sha256 = /^[a-f0-9]{64}$/iu;

export type OperatorBundle = {
  readonly contractVersion: typeof operatorBundleContractVersion;
  readonly sources: Readonly<{ en: BundleSource; cn: BundleSource }>;
  readonly biographySources: Readonly<{ en: BundleSource; cn: BundleSource }>;
  readonly operators: readonly OperatorRecord[];
  readonly biographies: readonly OperatorBiography[];
  readonly coverage: Readonly<{ operators: number; biographies: { readonly en: number; readonly cn: number; readonly total: number } }>;
  readonly integrity: Readonly<{ algorithm: "sha256"; sha256: string }>;
};

export type BundleSource = Readonly<{ repository: string; revision: string; path: string; sha256: string }>;
export type BundleIssue = Readonly<{ path: string; message: string }>;
export type BundleValidation = Readonly<{ ok: boolean; issues: readonly BundleIssue[]; expectedSha256?: string }>;

function issue(path: string, message: string): BundleIssue { return { path, message }; }
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}
function payload(bundle: Omit<OperatorBundle, "integrity">): string { return JSON.stringify(canonical(bundle)); }
export function bundleSha256(bundle: Omit<OperatorBundle, "integrity">): string { return createHash("sha256").update(payload(bundle), "utf8").digest("hex"); }
function ordered<T>(items: readonly T[], key: (item: T) => string): boolean { return items.every((item, index) => index === 0 || key(items[index - 1]).localeCompare(key(item), "en") <= 0); }
function validSource(source: unknown, path: string, issues: BundleIssue[]): source is BundleSource {
  if (!source || typeof source !== "object" || Array.isArray(source)) { issues.push(issue(path, "must be an object")); return false; }
  for (const key of ["repository", "revision", "path"] as const) if (typeof (source as Record<string, unknown>)[key] !== "string" || !(source as Record<string, unknown>)[key]) issues.push(issue(`${path}.${key}`, "must be non-empty"));
  if (typeof (source as Record<string, unknown>).sha256 !== "string" || !sha256.test(String((source as Record<string, unknown>).sha256))) issues.push(issue(`${path}.sha256`, "must be a SHA-256 hex value"));
  return true;
}
function validOperator(value: unknown, path: string, issues: BundleIssue[]): value is OperatorRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) { issues.push(issue(path, "must be an object")); return false; }
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || !/^char_\S+$/u.test(item.id)) issues.push(issue(`${path}.id`, "must be a char_* ID"));
  if (typeof item.name !== "string" || !item.name) issues.push(issue(`${path}.name`, "must be non-empty"));
  if (typeof item.slug !== "string" || !item.slug) issues.push(issue(`${path}.slug`, "must be non-empty"));
  if (!classes.has(item.class as OperatorClass)) issues.push(issue(`${path}.class`, "must be a known operator class"));
  if (!Number.isInteger(item.rarity) || Number(item.rarity) < 1 || Number(item.rarity) > 6) issues.push(issue(`${path}.rarity`, "must be an integer from 1 to 6"));
  if (typeof item.cnOnly !== "boolean" || (item.availabilityStatus !== "global-snapshot" && item.availabilityStatus !== "cn-snapshot-candidate")) issues.push(issue(path, "has invalid availability fields"));
  return true;
}

export function validateOperatorBundle(value: unknown): BundleValidation {
  const issues: BundleIssue[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, issues: [issue("", "bundle must be an object")] };
  const bundle = value as Record<string, unknown>;
  if (bundle.contractVersion !== operatorBundleContractVersion) issues.push(issue("contractVersion", `must be ${operatorBundleContractVersion}`));
  const sources = bundle.sources as Record<string, unknown> | undefined;
  const biographySources = bundle.biographySources as Record<string, unknown> | undefined;
  if (!sources) issues.push(issue("sources", "is required")); else { validSource(sources.en, "sources.en", issues); validSource(sources.cn, "sources.cn", issues); }
  if (!biographySources) issues.push(issue("biographySources", "is required")); else { validSource(biographySources.en, "biographySources.en", issues); validSource(biographySources.cn, "biographySources.cn", issues); }
  if (!Array.isArray(bundle.operators)) issues.push(issue("operators", "must be an array"));
  if (!Array.isArray(bundle.biographies)) issues.push(issue("biographies", "must be an array"));
  if (!bundle.integrity || typeof bundle.integrity !== "object" || (bundle.integrity as Record<string, unknown>).algorithm !== "sha256" || !sha256.test(String((bundle.integrity as Record<string, unknown>).sha256 ?? ""))) issues.push(issue("integrity", "must contain algorithm sha256 and a SHA-256 value"));
  const operators = Array.isArray(bundle.operators) ? bundle.operators : [];
  const biographies = Array.isArray(bundle.biographies) ? bundle.biographies : [];
  const ids = new Set<string>(); const slugs = new Set<string>();
  operators.forEach((item, index) => { if (validOperator(item, `operators[${index}]`, issues)) { const op = item as OperatorRecord; if (ids.has(op.id)) issues.push(issue(`operators[${index}].id`, "duplicate")); ids.add(op.id); if (slugs.has(op.slug)) issues.push(issue(`operators[${index}].slug`, "duplicate")); slugs.add(op.slug); } });
  if (!ordered(operators, (item) => String((item as Record<string, unknown>).id ?? ""))) issues.push(issue("operators", "must be sorted by id"));
  const bioKeys = new Set<string>();
  biographies.forEach((item, index) => { const result = validateBiography(item); if (!result.ok) result.issues.forEach((entry) => issues.push(issue(`biographies[${index}].${entry.path}`, entry.message))); else { const bio = result.value; if (!ids.has(bio.operatorId)) issues.push(issue(`biographies[${index}].operatorId`, "references an unknown operator")); if (!regions.has(bio.region)) issues.push(issue(`biographies[${index}].region`, "must be en or cn")); const expectedSource = biographySources?.[bio.region] as BundleSource | undefined; if (expectedSource && bio.source.revision !== expectedSource.revision) issues.push(issue(`biographies[${index}].source.revision`, "does not match the biography source revision")); if (expectedSource && bio.source.sha256 !== expectedSource.sha256) issues.push(issue(`biographies[${index}].source.sha256`, "does not match the biography source hash")); const key = `${bio.operatorId}\u0000${bio.region}\u0000${bio.source.revision}`; if (bioKeys.has(key)) issues.push(issue(`biographies[${index}]`, "duplicate operator, region and revision")); bioKeys.add(key); } });
  const coverage = bundle.coverage as Record<string, unknown> | undefined;
  if (!coverage || coverage.operators !== operators.length || !coverage.biographies || (coverage.biographies as Record<string, unknown>).en !== biographies.filter((item) => (item as Record<string, unknown>).region === "en").length || (coverage.biographies as Record<string, unknown>).cn !== biographies.filter((item) => (item as Record<string, unknown>).region === "cn").length || (coverage.biographies as Record<string, unknown>).total !== biographies.length) issues.push(issue("coverage", "does not match the bundle records"));
  if (!ordered(biographies, (item) => `${String((item as Record<string, unknown>).operatorId ?? "")}\u0000${String((item as Record<string, unknown>).region ?? "")}`)) issues.push(issue("biographies", "must be sorted by operatorId and region"));
  if (sources && bundle.integrity && issues.length === 0) { const withoutIntegrity = Object.fromEntries(Object.entries(bundle).filter(([key]) => key !== "integrity")) as Omit<OperatorBundle, "integrity">; const expectedSha256 = bundleSha256(withoutIntegrity); if (String((bundle.integrity as Record<string, unknown>).sha256).toLowerCase() !== expectedSha256) issues.push(issue("integrity.sha256", "does not match canonical bundle content")); return { ok: issues.length === 0, issues, expectedSha256 }; }
  return { ok: false, issues };
}
