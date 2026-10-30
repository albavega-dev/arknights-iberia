import { gameDataRevisions } from "./gamedata-revisions";

export type BiographyRegion = "en" | "cn";

export type BiographyField = {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly state: "value" | "empty";
};

export type BiographyProfile = {
  readonly storyTitle: string;
  readonly text: string;
};

export type OperatorBiography = {
  readonly operatorId: string;
  readonly region: BiographyRegion;
  readonly storyTitle: string;
  readonly source: { readonly repository: string; readonly revision: string; readonly path: string; readonly sha256: string };
  readonly fields: readonly BiographyField[];
  readonly originalText: string;
  readonly unrecognizedLines: readonly string[];
  readonly profile?: BiographyProfile | null;
};

export type HandbookSource = {
  readonly repository: string;
  readonly revision: string;
  readonly path: string;
  readonly sha256: string;
};

export type BiographyValidationIssue = { readonly path: string; readonly message: string };

export type BiographyValidationResult =
  | { readonly ok: true; readonly value: OperatorBiography }
  | { readonly ok: false; readonly issues: readonly BiographyValidationIssue[] };

export type BiographyRevisionConfig = Readonly<Record<BiographyRegion, string>>;
export type BiographySelectionResult = {
  readonly records: readonly OperatorBiography[];
  readonly missing: readonly MissingBiographyRevision[];
};

export type MissingBiographyRevision = {
  readonly operatorId: string;
  readonly region: BiographyRegion;
  readonly revision: string;
};

export const fixedBiographyRevisions: BiographyRevisionConfig = gameDataRevisions;

export type BiographyReadResult =
  | { readonly status: "found"; readonly biography: OperatorBiography }
  | { readonly status: "not-found"; readonly operatorId: string; readonly region: BiographyRegion; readonly revision: string };

export function biographyReadResult(biography: OperatorBiography | null, operatorId: string, region: BiographyRegion): BiographyReadResult {
  return biography ? { status: "found", biography } : { status: "not-found", operatorId, region, revision: fixedBiographyRevisions[region] };
}

type HandbookRecord = { storyTextAudio?: unknown };

const labels = {
  en: new Map([
    ["Code Name", "codeName"], ["Codename", "codeName"], ["Name", "name"], ["Gender", "gender"],
    ["Gender Assignment", "genderAssignment"], ["Combat Experience", "combatExperience"],
    ["Place of Birth", "placeOfBirth"], ["Date of Birth", "dateOfBirth"], ["Race", "race"],
    ["Height", "height"], ["Infection Status", "infectionStatus"],
  ]),
  cn: new Map([
    ["代号", "codeName"], ["姓名", "name"], ["性别", "gender"], ["设定性别", "genderAssignment"],
    ["战斗经验", "combatExperience"], ["出身地", "placeOfBirth"], ["生日", "dateOfBirth"],
    ["种族", "race"], ["身高", "height"], ["矿石病感染情况", "infectionStatus"],
  ]),
} as const;

export function extractBiography(
  operatorId: string,
  region: BiographyRegion,
  handbook: unknown,
  source: HandbookSource,
): OperatorBiography | null {
  if (!handbook || typeof handbook !== "object" || Array.isArray(handbook)) throw new Error("Handbook must be an object");
  const dict = (handbook as { handbookDict?: unknown }).handbookDict;
  if (!dict || typeof dict !== "object" || Array.isArray(dict)) throw new Error("Handbook handbookDict must be an object");
  const record = (dict as Record<string, HandbookRecord>)[operatorId];
  if (!record) return null;
  const entries = Array.isArray(record.storyTextAudio) ? record.storyTextAudio : [];
  const storyTitle = region === "en" ? "Basic Info" : "基础档案";
  const entry = entries.find((value) => value && typeof value === "object" && (value as { storyTitle?: unknown }).storyTitle === storyTitle) as { stories?: unknown } | undefined;
  if (!entry || !Array.isArray(entry.stories)) return null;
  const story = entry.stories.find((value) => value && typeof value === "object" && typeof (value as { storyText?: unknown }).storyText === "string") as { storyText: string } | undefined;
  if (!story) return null;
  const fields: BiographyField[] = [];
  const unrecognizedLines: string[] = [];
  let lastField: BiographyField | undefined;
  for (const line of story.storyText.split(/\r?\n/)) {
    const match = region === "en" ? /^\[([^\]]+)\]\s*(.*)$/.exec(line) : /^【([^】]+)】\s*(.*)$/.exec(line);
    if (!match) {
      if (line.trim() && lastField) {
        const value = lastField.value ? `${lastField.value}\n${line}` : line;
        const updated = { ...lastField, value, state: "value" as const };
        fields[fields.length - 1] = updated;
        lastField = updated;
      } else if (line.trim()) unrecognizedLines.push(line);
      continue;
    }
    const label = match[1];
    const value = match[2].trim();
    const field = { key: labels[region].get(label) ?? `unrecognized:${label}`, label, value, state: value ? "value" as const : "empty" as const };
    fields.push(field);
    lastField = field;
  }
  const profileTitle = region === "en" ? "Profile" : "客观履历";
  const profileEntry = entries.find((value) => value && typeof value === "object" && (value as { storyTitle?: unknown }).storyTitle === profileTitle) as { stories?: unknown } | undefined;
  const profileStory = profileEntry && Array.isArray(profileEntry.stories)
    ? profileEntry.stories.find((value) => value && typeof value === "object" && typeof (value as { storyText?: unknown }).storyText === "string") as { storyText: string } | undefined
    : undefined;
  return { operatorId, region, storyTitle, source, fields, originalText: story.storyText, unrecognizedLines, profile: profileStory ? { storyTitle: profileTitle, text: profileStory.storyText } : null };
}

export function auditBiographies(records: readonly OperatorBiography[], expectedIds: readonly string[]) {
  const expected = new Set(expectedIds);
  const actual = new Set(records.map((record) => record.operatorId));
  if (actual.size !== records.length) throw new Error("Duplicate biography IDs");
  const missing = expectedIds.filter((id) => !actual.has(id));
  const unexpected = records.map((record) => record.operatorId).filter((id) => !expected.has(id));
  const coverage: Record<string, number> = {};
  for (const record of records) for (const field of record.fields) if (field.state === "value") coverage[field.key] = (coverage[field.key] ?? 0) + 1;
  return { expectedCount: expectedIds.length, extractedCount: records.length, missing, unexpected, coverage };
}

function issue(path: string, message: string): BiographyValidationIssue { return { path, message }; }

export function validateBiography(value: unknown): BiographyValidationResult {
  const issues: BiographyValidationIssue[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, issues: [issue("", "Biography must be an object")] };
  const record = value as Record<string, unknown>;
  if (typeof record.operatorId !== "string" || !/^char_[^\s]+$/.test(record.operatorId)) issues.push(issue("operatorId", "must be a char_* operator ID"));
  if (record.region !== "en" && record.region !== "cn") issues.push(issue("region", "must be en or cn"));
  if (typeof record.storyTitle !== "string" || !record.storyTitle) issues.push(issue("storyTitle", "must be non-empty"));
  const source = record.source;
  if (!source || typeof source !== "object" || Array.isArray(source)) issues.push(issue("source", "must be an object"));
  else {
    const sourceRecord = source as Record<string, unknown>;
    for (const key of ["repository", "revision", "path"] as const) if (typeof sourceRecord[key] !== "string" || !sourceRecord[key]) issues.push(issue(`source.${key}`, "must be non-empty"));
    if (typeof sourceRecord.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(sourceRecord.sha256)) issues.push(issue("source.sha256", "must be a 64-character SHA-256 hex value"));
  }
  if (typeof record.originalText !== "string") issues.push(issue("originalText", "must be a string"));
  if (!Array.isArray(record.unrecognizedLines) || record.unrecognizedLines.some((line) => typeof line !== "string")) issues.push(issue("unrecognizedLines", "must be an array of strings"));
  if (record.profile !== undefined && record.profile !== null) {
    if (!record.profile || typeof record.profile !== "object" || Array.isArray(record.profile)) issues.push(issue("profile", "must be an object or null"));
    else {
      const profile = record.profile as Record<string, unknown>;
      if (typeof profile.storyTitle !== "string" || !profile.storyTitle) issues.push(issue("profile.storyTitle", "must be non-empty"));
      if (typeof profile.text !== "string") issues.push(issue("profile.text", "must be a string"));
    }
  }
  if (!Array.isArray(record.fields)) issues.push(issue("fields", "must be an array"));
  else record.fields.forEach((field, index) => {
    if (!field || typeof field !== "object" || Array.isArray(field)) { issues.push(issue(`fields[${index}]`, "must be an object")); return; }
    const fieldRecord = field as Record<string, unknown>;
    if (typeof fieldRecord.key !== "string" || !fieldRecord.key) issues.push(issue(`fields[${index}].key`, "must be non-empty"));
    if (typeof fieldRecord.label !== "string" || !fieldRecord.label) issues.push(issue(`fields[${index}].label`, "must be non-empty"));
    if (typeof fieldRecord.value !== "string") issues.push(issue(`fields[${index}].value`, "must be a string"));
    if (fieldRecord.state !== "value" && fieldRecord.state !== "empty") issues.push(issue(`fields[${index}].state`, "must be value or empty"));
  });
  if (issues.length) return { ok: false, issues };
  return { ok: true, value: value as OperatorBiography };
}

export function selectCurrentBiographies(records: readonly OperatorBiography[], revisions: BiographyRevisionConfig = fixedBiographyRevisions): BiographySelectionResult {
  const selected = new Map<string, OperatorBiography>();
  const duplicates = new Set<string>();
  for (const record of records) {
    const key = `${record.operatorId}\u0000${record.region}`;
    const revisionKey = `${key}\u0000${record.source.revision}`;
    if (selected.has(revisionKey)) duplicates.add(revisionKey);
    else selected.set(revisionKey, record);
  }
  if (duplicates.size) throw new Error(`Duplicate biography revisions: ${[...duplicates].join(", ")}`);
  const missing: MissingBiographyRevision[] = [];
  const current = new Map<string, OperatorBiography>();
  for (const record of selected.values()) if (record.source.revision === revisions[record.region]) current.set(`${record.operatorId}\u0000${record.region}`, record);
  for (const key of new Set([...selected.values()].map((record) => `${record.operatorId}\u0000${record.region}`))) {
    const [operatorId, region] = key.split("\u0000") as [string, BiographyRegion];
    if (!current.has(key)) missing.push({ operatorId, region, revision: revisions[region] });
  }
  return {
    records: [...current.values()].sort((a, b) => a.operatorId.localeCompare(b.operatorId, "en") || a.region.localeCompare(b.region, "en")),
    missing,
  };
}

/** Future Drizzle mapping: operatorId -> operators.id; source and fields map to operator_biographies columns/JSONB. */
