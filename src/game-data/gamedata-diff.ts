import { createHash } from "node:crypto";
import type { GameDataRegion } from "./gamedata-revisions";

// Pure comparison logic of scripts/check-gamedata-updates.ts: no network, no file system, no clock.
type Dict = Readonly<Record<string, unknown>>;
type Entry = Readonly<Record<string, unknown>>;

const playableProfessions = new Set(["WARRIOR", "PIONEER", "TANK", "SNIPER", "CASTER", "MEDIC", "SUPPORT", "SPECIAL"]);
const sorted = (values: Iterable<string>) => [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const asDict = (value: unknown): Dict => (value && typeof value === "object" && !Array.isArray(value) ? (value as Dict) : {});

/** Stable text of any JSON value (object keys sorted), used to compare structures. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Dict).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export const fingerprint = (value: unknown): string => createHash("sha256").update(stableJson(value)).digest("hex").slice(0, 16);

// --- Revisions level -------------------------------------------------------------------------------------------

export type CompareFile = Readonly<{ filename: string; status?: string }>;

export type BlobMap = Readonly<Record<string, string>>;

/** Names whose Git blob hash differs between two listings, including names present in only one of them. */
export function changedBlobs(before: BlobMap, after: BlobMap): string[] {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  return sorted([...names].filter((name) => before[name] !== after[name]));
}

/** GitHub lists at most 300 files per compare: with that many, the list cannot be trusted to be complete. */
export const compareFileLimit = 300;
export const mayBeTruncated = (files: readonly CompareFile[]) => files.length >= compareFileLimit;

export type AssetChange = Readonly<{ added: number; modified: number; removed: number; renamed: number }>;

/** Counts changes per watched top-level directory of an image repository. */
export function assetChangesByDirectory(files: readonly CompareFile[], directories: readonly string[]): Record<string, AssetChange> {
  const result: Record<string, { added: number; modified: number; removed: number; renamed: number }> = {};
  for (const directory of directories) result[directory] = { added: 0, modified: 0, removed: 0, renamed: 0 };
  for (const file of files) {
    const directory = directories.find((item) => file.filename.startsWith(`${item}/`));
    if (!directory) continue;
    const counts = result[directory];
    if (file.status === "added") counts.added += 1;
    else if (file.status === "removed") counts.removed += 1;
    else if (file.status === "renamed") counts.renamed += 1;
    else counts.modified += 1;
  }
  return result;
}

/** Paths of the changed files in the watched directories, at most `limit`. */
export function changedAssetPaths(files: readonly CompareFile[], directories: readonly string[], limit = 40): string[] {
  return files.filter((file) => directories.some((directory) => file.filename.startsWith(`${directory}/`))).map((file) => `${file.status ?? "modified"} ${file.filename}`).slice(0, limit);
}

export type RevisionStatus = Readonly<{ pinned: string; latest: string; changed: boolean }>;
export const revisionStatus = (pinned: string, latest: string): RevisionStatus => ({ pinned, latest, changed: pinned !== latest });

// --- Roster ----------------------------------------------------------------------------------------------------

/** Same definition of "playable" the regional manifests were reviewed with. */
export function isPlayable(record: unknown): boolean {
  const value = asDict(record);
  return value.isNotObtainable === false
    && typeof value.name === "string" && value.name.trim() !== ""
    && typeof value.profession === "string" && playableProfessions.has(value.profession)
    && Array.isArray(value.phases)
    && /^TIER_[1-6]$/u.test(String(value.rarity));
}

export function playableOperatorIds(characterTable: unknown): string[] {
  return sorted(Object.entries(asDict(characterTable)).filter(([id, record]) => id.startsWith("char_") && isPlayable(record)).map(([id]) => id));
}

export type Catalog = Readonly<{ en: readonly string[]; cnOnly: readonly string[] }>;
export type RosterReport = Readonly<{ newInCn: string[]; arrivedInGlobal: string[]; noLongerPlayable: { en: string[]; cn: string[] } }>;

export function compareRoster(catalog: Catalog, enPlayable: readonly string[], cnPlayable: readonly string[]): RosterReport {
  const known = new Set([...catalog.en, ...catalog.cnOnly]);
  const en = new Set(enPlayable);
  const cn = new Set(cnPlayable);
  return {
    newInCn: sorted(cnPlayable.filter((id) => !known.has(id))),
    arrivedInGlobal: sorted(catalog.cnOnly.filter((id) => en.has(id))),
    noLongerPlayable: {
      en: sorted(catalog.en.filter((id) => !en.has(id))),
      cn: sorted(catalog.cnOnly.filter((id) => !cn.has(id) && !en.has(id))),
    },
  };
}

// --- Existing operators ----------------------------------------------------------------------------------------

const operatorFields: readonly (readonly [string, (record: Entry) => unknown])[] = [
  ["name", (r) => r.name],
  ["rarity", (r) => r.rarity],
  ["profession", (r) => r.profession],
  ["subProfessionId", (r) => r.subProfessionId],
  ["phases", (r) => r.phases],
  ["skillIds", (r) => (Array.isArray(r.skills) ? r.skills.map((skill) => asDict(skill).skillId) : [])],
  ["talents", (r) => r.talents],
  ["trait", (r) => r.trait],
];

export type OperatorChange = Readonly<{ id: string; fields: string[] }>;

/** Catalog operators whose identity, phases, skills, talents or trait differ between two character tables. */
export function diffOperators(before: unknown, after: unknown, ids: readonly string[]): { changed: OperatorChange[]; missing: string[] } {
  const previous = asDict(before);
  const current = asDict(after);
  const changed: OperatorChange[] = [];
  const missing: string[] = [];
  for (const id of sorted(ids)) {
    const oldRecord = asDict(previous[id]);
    const newRecord = asDict(current[id]);
    if (!(id in current)) { missing.push(id); continue; }
    if (!(id in previous)) continue;
    const fields = operatorFields.filter(([, read]) => stableJson(read(oldRecord)) !== stableJson(read(newRecord))).map(([field]) => field);
    if (fields.length) changed.push({ id, fields });
  }
  return { changed, missing };
}

export function skillIdsOf(characterTable: unknown, ids: readonly string[]): string[] {
  const table = asDict(characterTable);
  const result = new Set<string>();
  for (const id of ids) {
    const skills = asDict(table[id]).skills;
    if (!Array.isArray(skills)) continue;
    for (const skill of skills) { const skillId = asDict(skill).skillId; if (typeof skillId === "string") result.add(skillId); }
  }
  return sorted(result);
}

/** Icon names of the skills: the table's iconId when it has one, the skill id otherwise. */
export function skillIconNames(skillTable: unknown, skillIds: readonly string[]): string[] {
  const table = asDict(skillTable);
  return sorted(new Set(skillIds.map((id) => { const iconId = asDict(table[id]).iconId; return typeof iconId === "string" && iconId ? iconId : id; })));
}

export type KeyedChange = Readonly<{ added: string[]; modified: string[]; removed: string[] }>;

/** Generic comparison of two keyed collections, restricted to `keys` when given. */
export function diffKeyed(before: Dict, after: Dict, keys?: readonly string[]): KeyedChange {
  const scope = keys ?? [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const added: string[] = [];
  const modified: string[] = [];
  const removed: string[] = [];
  for (const key of scope) {
    const inBefore = key in before;
    const inAfter = key in after;
    if (!inBefore && inAfter) added.push(key);
    else if (inBefore && !inAfter) removed.push(key);
    else if (inBefore && inAfter && stableJson(before[key]) !== stableJson(after[key])) modified.push(key);
  }
  return { added: sorted(added), modified: sorted(modified), removed: sorted(removed) };
}

/** Per-skill fingerprint: levels, blackboard and description hash, for the skills of the catalog. */
export function skillFingerprints(skillTable: unknown, skillIds: readonly string[]): Record<string, string> {
  const table = asDict(skillTable);
  const result: Record<string, string> = {};
  for (const id of skillIds) if (id in table) result[id] = fingerprint(table[id]);
  return result;
}

export function diffSkills(before: unknown, after: unknown, skillIds: readonly string[]): KeyedChange {
  return diffKeyed(skillFingerprints(before, skillIds), skillFingerprints(after, skillIds));
}

// --- Modules, biographies, base, ranges ------------------------------------------------------------------------

/** Module ids that belong to catalog operators. */
export function catalogModuleIds(uniequipTable: unknown, ids: readonly string[], options: Readonly<{ withInitial?: boolean }> = {}): string[] {
  const scope = new Set(ids);
  const withInitial = options.withInitial ?? true;
  return sorted(Object.entries(asDict(asDict(uniequipTable).equipDict))
    .filter(([, equip]) => scope.has(String(asDict(equip).charId)) && (withInitial || asDict(equip).type !== "INITIAL"))
    .map(([id]) => id));
}

export type ModuleReport = Readonly<{ added: string[]; modified: string[]; removed: string[] }>;

export function diffModules(before: { uniequip: unknown; battleEquip: unknown }, after: { uniequip: unknown; battleEquip: unknown }, ids: readonly string[]): ModuleReport {
  const scope = sorted(new Set([...catalogModuleIds(before.uniequip, ids), ...catalogModuleIds(after.uniequip, ids)]));
  const definition = diffKeyed(asDict(asDict(before.uniequip).equipDict), asDict(asDict(after.uniequip).equipDict), scope);
  const battle = diffKeyed(asDict(before.battleEquip), asDict(after.battleEquip), scope);
  return {
    added: sorted(new Set([...definition.added, ...battle.added])),
    modified: sorted(new Set([...definition.modified, ...battle.modified].filter((id) => !definition.added.includes(id) && !battle.added.includes(id)))),
    removed: sorted(new Set([...definition.removed, ...battle.removed])),
  };
}

export const handbookEntries = (table: unknown): Dict => asDict(asDict(table).handbookDict);
export const buildingEntries = (table: unknown): Dict => asDict(asDict(table).chars);

/** Range ids that the phases of the given operators refer to. */
export function usedRangeIds(characterTable: unknown, ids: readonly string[]): string[] {
  const table = asDict(characterTable);
  const used = new Set<string>();
  for (const id of ids) {
    const phases = asDict(table[id]).phases;
    if (!Array.isArray(phases)) continue;
    for (const phase of phases) { const rangeId = asDict(phase).rangeId; if (typeof rangeId === "string" && rangeId) used.add(rangeId); }
  }
  return sorted(used);
}

export function newGlossaryTerms(before: unknown, after: unknown): string[] {
  const previous = asDict(asDict(before).termDescriptionDict);
  return sorted(Object.keys(asDict(asDict(after).termDescriptionDict)).filter((term) => !(term in previous)));
}

// --- Texts and labels that need attention ----------------------------------------------------------------------

export type LabelInputs = Readonly<{
  characterTable: unknown;
  uniequipTable: unknown;
  ids: readonly string[];
  archetypeLabels: Readonly<Record<string, string>>;
  modeNames: Readonly<{ gameTags: Dict; mapTags: Dict }>;
  moduleIcons: ReadonlySet<string>;
  battleEquip: unknown;
}>;

export type LabelReport = Readonly<{ subClassIds: string[]; gameTags: string[]; mapTags: string[]; typeIcons: string[] }>;

/** What the catalog needs a label, a name or a file for and does not have yet. */
export function missingLabels(input: LabelInputs): LabelReport {
  const characters = asDict(input.characterTable);
  const subClassIds = new Set<string>();
  for (const id of input.ids) {
    const subClass = asDict(characters[id]).subProfessionId;
    if (typeof subClass === "string" && subClass && !(subClass in input.archetypeLabels)) subClassIds.add(subClass);
  }
  const moduleIds = catalogModuleIds(input.uniequipTable, input.ids);
  const equipDict = asDict(asDict(input.uniequipTable).equipDict);
  const typeIcons = new Set<string>();
  for (const id of moduleIds) {
    const icon = asDict(equipDict[id]).typeIcon;
    if (typeof icon === "string" && icon.toLowerCase() !== "original" && !input.moduleIcons.has(icon.toLowerCase())) typeIcons.add(icon.toLowerCase());
  }
  const gameTags = new Set<string>();
  const mapTags = new Set<string>();
  const battle = asDict(input.battleEquip);
  for (const id of moduleIds) {
    const phases = asDict(battle[id]).phases;
    if (!Array.isArray(phases)) continue;
    for (const phase of phases) {
      const parts = asDict(phase).parts;
      if (!Array.isArray(parts)) continue;
      for (const part of parts) {
        const { validInGameTag, validInMapTag } = asDict(part);
        if (typeof validInGameTag === "string" && validInGameTag && !(validInGameTag in input.modeNames.gameTags)) gameTags.add(validInGameTag);
        if (typeof validInMapTag === "string" && validInMapTag && !(validInMapTag in input.modeNames.mapTags)) mapTags.add(validInMapTag);
      }
    }
  }
  return { subClassIds: sorted(subClassIds), gameTags: sorted(gameTags), mapTags: sorted(mapTags), typeIcons: sorted(typeIcons) };
}

export type SkillGap = Readonly<{ skillId: string; key: string; fix?: unknown }>;

/** Known source defects whose key the source now carries at every level, so the correction could be dropped. */
export function resolvedSkillGaps(skillTable: unknown, gaps: readonly SkillGap[]): string[] {
  const table = asDict(skillTable);
  const resolved: string[] = [];
  for (const gap of gaps) {
    const levels = asDict(table[gap.skillId]).levels;
    if (!Array.isArray(levels) || levels.length === 0) continue;
    const present = levels.every((level) => {
      const blackboard = asDict(level).blackboard;
      return Array.isArray(blackboard) && blackboard.some((item) => String(asDict(item).key).toLowerCase() === gap.key.toLowerCase());
    });
    if (present) resolved.push(`${gap.skillId}/${gap.key}`);
  }
  return sorted(resolved);
}

// --- Graphic resources -----------------------------------------------------------------------------------------

export type AssetNeeds = Readonly<{
  illustrations: readonly string[];
  skillIcons: readonly string[];
  moduleArt: readonly string[];
}>;

export type AssetCoverage = Readonly<{ missingIllustrations: string[]; missingSkillIcons: string[]; missingModuleArt: string[] }>;

/** Files the image repository has no entry for, from its tree listing. */
export function assetCoverage(paths: ReadonlySet<string>, needs: AssetNeeds): AssetCoverage {
  return {
    missingIllustrations: sorted(needs.illustrations.filter((id) => !paths.has(`characters/${id}_1.png`))),
    missingSkillIcons: sorted(needs.skillIcons.filter((id) => !paths.has(`skills/skill_icon_${id}.png`))),
    missingModuleArt: sorted(needs.moduleArt.filter((id) => !paths.has(`equip/icon/${id}.png`))),
  };
}

export const regions: readonly GameDataRegion[] = ["en", "cn"];

// --- Result ----------------------------------------------------------------------------------------------------

/** 0: nothing new; 2: something to review. Failures (1) are handled by the caller. */
export function exitCodeFor(report: unknown): 0 | 2 {
  const walk = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value > 0;
    if (value && typeof value === "object") return Object.entries(value).some(([key, item]) => key !== "pinned" && key !== "latest" && key !== "level" && walk(item));
    return false;
  };
  return walk(asDict(report).findings) ? 2 : 0;
}

/** Removes a secret and local directories from text before it is printed. */
export function redact(text: string, secrets: readonly (string | undefined)[]): string {
  let result = text;
  for (const secret of secrets) if (secret) result = result.split(secret).join("[redacted]");
  return result;
}
