import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gameDataRevisions, gameDataTableHashes } from "../src/game-data/gamedata-revisions";
import { isReleaseDateProvenance } from "../src/game-data/operator-catalog";

type SnapshotRecord = { readonly isNotObtainable?: unknown; readonly name?: unknown; readonly profession?: unknown; readonly phases?: unknown; readonly rarity?: unknown };
type Manifest = { readonly operators?: readonly { readonly id?: unknown; readonly cnReleaseDate?: unknown; readonly cnReleaseDateProvenance?: unknown }[]; readonly snapshot?: { readonly locale?: unknown; readonly path?: unknown; readonly revision?: unknown }; readonly comparison?: { readonly en?: { readonly path?: unknown; readonly revision?: unknown }; readonly cn?: { readonly path?: unknown; readonly revision?: unknown } } };
type Io = { readonly read: (path: string) => Promise<Buffer>; readonly stdout: (value: string) => void; readonly stderr: (value: string) => void };
type Result = { readonly status: "ok" | "mismatch" | "invalid" | "unverifiable"; readonly code: string; readonly provenance: { readonly en: string; readonly cn: string }; readonly counts: { readonly en: number; readonly cn: number; readonly cnOnly: number; readonly enOnly: number }; readonly manifestComparison: { readonly globalMissing: number; readonly globalUnexpected: number; readonly cnOnlyMissing: number; readonly cnOnlyUnexpected: number }; readonly duplicates: { readonly en: number; readonly cn: number; readonly globalManifest: number; readonly regionalManifest: number }; readonly regionalProvenance: { readonly declared: number; readonly invalid: number } };

const refs = {
  en: { revision: gameDataRevisions.en, sha256: gameDataTableHashes.en.character_table },
  cn: { revision: gameDataRevisions.cn, sha256: gameDataTableHashes.cn.character_table },
} as const;
const professions = new Set(["WARRIOR", "PIONEER", "TANK", "SNIPER", "CASTER", "MEDIC", "SUPPORT", "SPECIAL"]);
const knownFlags = new Set(["--en-snapshot", "--cn-snapshot"]);

function json(value: Result): string { return `${JSON.stringify(value)}\n`; }
function failure(code: Result["code"], status: Result["status"] = "invalid"): Result { return { status, code, provenance: { en: "unverifiable", cn: "unverifiable" }, counts: { en: 0, cn: 0, cnOnly: 0, enOnly: 0 }, manifestComparison: { globalMissing: 0, globalUnexpected: 0, cnOnlyMissing: 0, cnOnlyUnexpected: 0 }, duplicates: { en: 0, cn: 0, globalManifest: 0, regionalManifest: 0 }, regionalProvenance: { declared: 0, invalid: 0 } }; }
function args(argv: readonly string[]): { en?: string; cn?: string; error?: string } {
  const values: Partial<Record<"--en-snapshot" | "--cn-snapshot", string>> = {};
  for (let i = 0; i < argv.length; i += 2) { const flag = argv[i]; if (!knownFlags.has(flag)) return { error: "invalid-arguments" }; const value = argv[i + 1]; if (!value || value.startsWith("--") || values[flag as "--en-snapshot" | "--cn-snapshot"] !== undefined) return { error: "invalid-arguments" }; values[flag as "--en-snapshot" | "--cn-snapshot"] = value; }
  if (!values["--en-snapshot"] || !values["--cn-snapshot"] || argv.length !== 4) return { error: "missing-arguments" };
  return { en: values["--en-snapshot"], cn: values["--cn-snapshot"] };
}
export function playable(value: SnapshotRecord): boolean { return value.isNotObtainable === false && typeof value.name === "string" && value.name.trim() !== "" && typeof value.profession === "string" && professions.has(value.profession) && Array.isArray(value.phases) && /^TIER_[1-6]$/u.test(String(value.rarity)); }
function ids(value: unknown): { readonly ids: readonly string[]; readonly duplicates: number } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: string[] = []; const seen = new Set<string>(); let duplicates = 0;
  for (const [id, record] of Object.entries(value)) { if (!/^char_/u.test(id)) continue; if (playable(record as SnapshotRecord)) { if (seen.has(id)) duplicates += 1; seen.add(id); result.push(id); } }
  return { ids: result, duplicates };
}
function manifestIds(value: Manifest): { readonly ids: readonly string[]; readonly duplicates: number } | undefined { if (!Array.isArray(value.operators)) return undefined; const result = value.operators.map((item) => item.id); if (!result.every((id): id is string => typeof id === "string" && /^char_/u.test(id))) return undefined; return { ids: result, duplicates: result.length - new Set(result).size }; }
function manifestSourceValid(value: Manifest, region: "en" | "cn"): boolean {
  const source = region === "en" ? value.snapshot : value.comparison?.cn;
  return region === "en"
    ? source?.path === "en/gamedata/excel/character_table.json" && source.revision === refs.en.revision
    : source?.path === "cn/gamedata/excel/character_table.json" && source.revision === refs.cn.revision;
}
// A per-operator provenance is optional and only valid on an entry with a CN release date.
function provenanceCounts(value: Manifest): { readonly declared: number; readonly invalid: number } { const declared = (value.operators ?? []).filter((item) => item.cnReleaseDateProvenance !== undefined); return { declared: declared.length, invalid: declared.filter((item) => !isReleaseDateProvenance(item.cnReleaseDateProvenance) || typeof item.cnReleaseDate !== "string").length }; }
function difference(left: readonly string[], right: readonly string[]): number { const set = new Set(right); return left.filter((id) => !set.has(id)).length; }

export async function verifyRegionalSets(argv: readonly string[], io: Io = { read: (path) => readFile(path), stdout: (value) => process.stdout.write(value), stderr: (value) => process.stderr.write(value) }): Promise<number> {
  const parsed = args(argv); if (parsed.error) { io.stderr(json(failure(parsed.error))); return 2; }
  try {
    const [enBytes, cnBytes, globalBytes, regionalBytes] = await Promise.all([io.read(parsed.en!), io.read(parsed.cn!), io.read("data/operator-cn-release-manifest.json"), io.read("data/operator-regional-manifest.json")]);
    const provenance = { en: createHash("sha256").update(enBytes).digest("hex").toUpperCase() === refs.en.sha256 ? "hash-matched" : "hash-mismatch", cn: createHash("sha256").update(cnBytes).digest("hex").toUpperCase() === refs.cn.sha256 ? "hash-matched" : "hash-mismatch" } as const;
    const globalManifest = JSON.parse(globalBytes.toString("utf8")) as Manifest; const regionalManifest = JSON.parse(regionalBytes.toString("utf8")) as Manifest; const en = ids(JSON.parse(enBytes.toString("utf8"))); const cn = ids(JSON.parse(cnBytes.toString("utf8"))); const global = manifestIds(globalManifest); const regional = manifestIds(regionalManifest);
    if (!en || !cn || !global || !regional) { const result = failure("invalid-snapshot"); io.stderr(json(result)); return 2; }
    const enSet = new Set(en.ids); const cnOnly = cn.ids.filter((id) => !enSet.has(id)); const enOnly = en.ids.filter((id) => !new Set(cn.ids).has(id));
    const sourceMetadataValid = manifestSourceValid(globalManifest, "en") && manifestSourceValid(regionalManifest, "cn"); const regionalProvenance = provenanceCounts(regionalManifest); const result: Result = { status: provenance.en === "hash-matched" && provenance.cn === "hash-matched" && sourceMetadataValid && regionalProvenance.invalid === 0 && en.ids.length === global.ids.length && cn.ids.length === global.ids.length + regional.ids.length && cnOnly.length === regional.ids.length && enOnly.length === 0 && global.duplicates === 0 && regional.duplicates === 0 && difference(en.ids, global.ids) === 0 && difference(global.ids, en.ids) === 0 && difference(cnOnly, regional.ids) === 0 && difference(regional.ids, cnOnly) === 0 ? "ok" : provenance.en === "hash-mismatch" || provenance.cn === "hash-mismatch" ? "mismatch" : "unverifiable", code: "regional-set-check", provenance, counts: { en: en.ids.length, cn: cn.ids.length, cnOnly: cnOnly.length, enOnly: enOnly.length }, manifestComparison: { globalMissing: difference(global.ids, en.ids), globalUnexpected: difference(en.ids, global.ids), cnOnlyMissing: difference(regional.ids, cnOnly), cnOnlyUnexpected: difference(cnOnly, regional.ids) }, duplicates: { en: en.duplicates, cn: cn.duplicates, globalManifest: global.duplicates, regionalManifest: regional.duplicates }, regionalProvenance };
    io.stdout(json(result)); return result.status === "ok" ? 0 : 1;
  } catch { const result = failure("input-read-or-json-error"); io.stderr(json(result)); return 2; }
}

if (process.argv[1]?.endsWith("verify-operator-regional-sets.ts")) void verifyRegionalSets(process.argv.slice(2));
