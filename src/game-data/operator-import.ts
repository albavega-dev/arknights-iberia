import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import type { OperatorClass, OperatorRecord } from "./operators";

type SourceCharacter = {
  name?: unknown;
  profession?: unknown;
  subProfessionId?: unknown;
  rarity?: unknown;
  isNotObtainable?: unknown;
  phases?: unknown;
  mainPower?: unknown;
  subPower?: unknown;
};

const professionMap: Record<string, OperatorClass> = {
  WARRIOR: "Guard",
  PIONEER: "Vanguard",
  TANK: "Defender",
  SNIPER: "Sniper",
  CASTER: "Caster",
  MEDIC: "Medic",
  SUPPORT: "Supporter",
  SPECIAL: "Specialist",
};

export type NormalizedOperator = OperatorRecord & { sourceId: string };

function mainPower(value: SourceCharacter): { nationId: string | null; groupId: string | null; teamId: string | null } {
  const power = value.mainPower;
  if (!power || typeof power !== "object" || Array.isArray(power))
    return { nationId: null, groupId: null, teamId: null };
  const record = power as Record<string, unknown>;
  return {
    nationId: typeof record.nationId === "string" ? record.nationId : null,
    groupId: typeof record.groupId === "string" ? record.groupId : null,
    teamId: typeof record.teamId === "string" ? record.teamId : null,
  };
}

export function normalizeOperator(sourceId: string, value: SourceCharacter): NormalizedOperator | null {
  if (!sourceId.startsWith("char_") || value.isNotObtainable !== false) return null;
  if (typeof value.name !== "string" || value.name.trim() === "") return null;
  if (typeof value.profession !== "string" || !professionMap[value.profession]) return null;
  if (!Array.isArray(value.phases) || value.phases.length === 0) return null;
  if (typeof value.rarity !== "string" || !/^TIER_[1-6]$/.test(value.rarity)) return null;

  const slug = `operator-${sourceId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const power = mainPower(value);
  return {
    sourceId,
    id: sourceId,
    name: value.name,
    cnName: null,
    globalName: null,
    class: professionMap[value.profession],
    subClassId: typeof value.subProfessionId === "string" ? value.subProfessionId : null,
    rarity: Number(value.rarity.slice(-1)) as NormalizedOperator["rarity"],
    slug,
    cnOnly: false,
    availabilityStatus: "global-snapshot",
    cnReleaseDate: null,
    globalReleaseDate: null,
    mainPowerNationId: power.nationId,
    mainPowerGroupId: power.groupId,
    mainPowerTeamId: power.teamId,
    mainFactionId: null,
    hasSubPower: Array.isArray(value.subPower) && value.subPower.length > 0,
  };
}

export function normalizeCharacterTable(source: unknown): { operators: NormalizedOperator[]; skipped: number } {
  if (!source || typeof source !== "object" || Array.isArray(source))
    throw new Error("Source character table must be a JSON object");
  const operators: NormalizedOperator[] = [];
  let skipped = 0;
  for (const [sourceId, value] of Object.entries(source)) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error(`Invalid source record: ${sourceId}`);
    const normalized = normalizeOperator(sourceId, value as SourceCharacter);
    if (normalized) operators.push(normalized);
    else skipped += 1;
  }
  const slugs = new Set(operators.map((operator) => operator.slug));
  if (slugs.size !== operators.length) throw new Error("Source produced colliding operator slugs");
  return { operators, skipped };
}

export function sourceFingerprint(sourceRevision: string, dataVersion: string): string {
  return createHash("sha256").update(`${sourceRevision}\n${dataVersion}`).digest("hex");
}

export async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}
