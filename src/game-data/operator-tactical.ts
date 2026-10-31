import tacticalManifest from "../../data/operator-tactical-manifest.json";
import associatedRanges from "../../data/operator-associated-ranges.json";
import { assetPath } from "./asset-paths";
import { gameDataRevisions } from "./gamedata-revisions";

export type TacticalPhase = Readonly<{ phase: number; rangeId: string | null; rangeKey: string | null }>;
export type TacticalRangeDefinition = Readonly<{ direction: number | null; grids: readonly { row: number; col: number }[] }>;
export type TacticalModuleRange = Readonly<{
  moduleId: string;
  moduleName: string;
  mechanism?: "rangeId" | "ability_range_forward_extend";
  level: number;
  rangeKey: string;
  grids: readonly { row: number; col: number }[];
  iconUrl: string;
  evidenceUrl: string;
  ownerType?: "operator" | "substitute";
}>;
export type TacticalAssociatedRange = Readonly<{
  ownerType: "substitute" | "entity";
  ownerId?: string;
  ownerName?: string;
  groupKey?: string;
  skillId?: string;
  rangePurpose: "basic-attack" | "effect";
  rangeKey: string;
  rangeId: string;
  condition: string;
  source: Readonly<{ region: "en" | "cn"; revision: string; file: string; path: string }>;
  evidence: string;
}>;
export type OperatorTacticalEntry = Readonly<{
  id: string;
  source: Readonly<{ region: "en" | "cn"; revision: string }> | null;
  position: string | null;
  tags: readonly string[];
  phases: readonly TacticalPhase[];
}>;
type TacticalManifest = Readonly<{
  operators: readonly OperatorTacticalEntry[];
  rangeDefinitions: Record<string, TacticalRangeDefinition>;
  moduleRanges?: readonly (TacticalModuleManifestEntry)[];
}>;
type TacticalModuleManifestEntry = Readonly<{
  operatorId: string;
  uniEquipId: string;
  moduleType: string;
  mechanism: "rangeId" | "ability_range_forward_extend";
  level: number;
  rangeKey: string;
  grids: readonly { row: number; col: number }[];
  iconUrl: string;
  evidenceUrl: string;
  ownerType?: "operator" | "substitute";
}>;

const manifest = tacticalManifest as TacticalManifest;
const entries = new Map(manifest.operators.map((entry) => [entry.id, entry]));
const associatedRangeOperators = new Set(Object.keys((associatedRanges as { substitutes: object }).substitutes));
const manifestModuleRanges = new Map<string, readonly TacticalModuleRange[]>(
  (manifest.moduleRanges ?? []).reduce<Map<string, TacticalModuleRange[]>>((result, module) => {
    const current = result.get(module.operatorId) ?? [];
    if (!associatedRangeOperators.has(module.operatorId) && module.ownerType !== "substitute") current.push({ ...module, moduleId: module.uniEquipId, moduleName: module.moduleType, ownerType: "operator" });
    result.set(module.operatorId, current);
    return result;
  }, new Map()),
);

const sentryProtectorModuleGrids = [
  { row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }, { row: 0, col: 3 },
] as const;

export function getOperatorTacticalEntry(operatorId: string): OperatorTacticalEntry | null {
  return entries.get(operatorId) ?? null;
}

export function getTacticalRangeDefinition(rangeKey: string | null): TacticalRangeDefinition | null {
  return rangeKey ? manifest.rangeDefinitions[rangeKey] ?? null : null;
}

const confirmedModuleRanges: Readonly<Record<string, readonly TacticalModuleRange[]>> = {
  char_1034_jesca2: [{ moduleId: "uniequip_003_jesca2", moduleName: "SPT-Y", level: 1, rangeKey: "module:spt-y", grids: sentryProtectorModuleGrids, iconUrl: assetPath("operator-modules", "spt-y.png"), evidenceUrl: "https://arknights.wiki.gg/wiki/Jessica_the_Liberated" }],
  char_4194_rmixer: [{ moduleId: "uniequip_003_rmixer", moduleName: "SPT-Y", level: 1, rangeKey: "module:spt-y", grids: sentryProtectorModuleGrids, iconUrl: assetPath("operator-modules", "spt-y.png"), evidenceUrl: "https://arknights.wiki.gg/wiki/Sankta_Miksaparato" }],
};

export function getConfirmedModuleRanges(operatorId: string): readonly TacticalModuleRange[] {
  return [...(confirmedModuleRanges[operatorId] ?? []), ...(manifestModuleRanges.get(operatorId) ?? [])];
}

type AssociatedRangeRecord = Omit<TacticalAssociatedRange, "source"> & Readonly<{ source: Omit<TacticalAssociatedRange["source"], "revision"> }>;
const curation = associatedRanges as Readonly<Record<"substitutes" | "entities", Readonly<Record<string, readonly AssociatedRangeRecord[]>>>>;
const withRevision = (records: readonly AssociatedRangeRecord[] | undefined): readonly TacticalAssociatedRange[] =>
  (records ?? []).map((record) => ({ ...record, source: { ...record.source, revision: gameDataRevisions[record.source.region] } }));

export function getAssociatedRanges(operatorId: string): readonly TacticalAssociatedRange[] {
  return [...withRevision(curation.substitutes[operatorId]), ...withRevision(curation.entities[operatorId])];
}
