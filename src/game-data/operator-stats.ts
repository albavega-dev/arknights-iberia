import type { TraitStage } from "./operator-modules";

export type StatsRegion = "en" | "cn";

export type StatValue = number;
export type StatKeyframe = Readonly<{
  level: number;
  attributes: Readonly<Record<string, StatValue>>;
}>;

export type OperatorStatsProfile = Readonly<{
  operatorId: string;
  region: StatsRegion;
  source: Readonly<{ repository: string; revision: string; path: string; sha256: string }>;
  phases: readonly Readonly<{
    phase: number;
    maxLevel: number;
    keyframes: readonly StatKeyframe[];
  }>[];
  favorKeyframes: readonly Readonly<{ level: number; attributes: Readonly<Record<string, StatValue>> }>[];
  potentialRanks: readonly Readonly<{ rank: number; effects: readonly unknown[] }>[];
  modules: readonly OperatorModuleStats[];
  /** Trait stages from character_table, with their unlock and potential; the generator fills them for catalog operators. */
  trait: readonly TraitStage[];
}>;

export type OperatorModuleStats = Readonly<{
  uniEquipId: string;
  operatorId: string;
  region: StatsRegion;
  name: string;
  moduleType?: string;
  typeIcon?: string;
  moduleSourceRegion?: StatsRegion;
  levels: readonly Readonly<{ level: number; attributes: Readonly<Record<string, number>>; specialEffects: readonly string[] }>[];
}>;

export type OperatorStatsManifest = Readonly<{
  contractVersion: "1";
  profiles: readonly OperatorStatsProfile[];
}>;

export const displayStatLabels: Readonly<Record<string, string>> = {
  maxHp: "PV",
  atk: "ATK",
  def: "DEF",
  magicResistance: "RES",
  cost: "Coste DP",
  blockCnt: "Bloqueo",
  baseAttackTime: "Intervalo",
  respawnTime: "Reaparición",
};
export const moduleAttributeLabels: Readonly<Record<string, string>> = { max_hp: "PV", atk: "ATK", def: "DEF", cost: "Coste DP", attack_speed: "Velocidad de ataque", magic_resistance: "RES", block_cnt: "Bloqueo", respawn_time: "Reaparición" };
const potentialAttributeLabels: Readonly<Record<string, string>> = { MAX_HP: "PV", ATK: "ATK", DEF: "DEF", COST: "Coste DP", RES: "RES", BLOCK: "Bloqueo", RESPawn_TIME: "Reaparición", RESPAWN_TIME: "Reaparición" };

export type PotentialDisplayRow = Readonly<{ label: string; value: string; special: boolean }>;
export function potentialDisplayRows(effects: readonly unknown[]): PotentialDisplayRow[] {
  const rows: PotentialDisplayRow[] = [];
  for (const effect of effects) {
    const attributes = effect && typeof effect === "object" && !Array.isArray(effect) ? (effect as Record<string, unknown>).attributes : undefined;
    const modifiers = attributes && typeof attributes === "object" && !Array.isArray(attributes) ? (attributes as Record<string, unknown>).attributeModifiers : undefined;
    if (Array.isArray(modifiers)) for (const modifier of modifiers) {
      if (!modifier || typeof modifier !== "object" || Array.isArray(modifier)) continue;
      const item = modifier as Record<string, unknown>;
      const label = typeof item.attributeType === "string" ? potentialAttributeLabels[item.attributeType] ?? item.attributeType : null;
      if (label && typeof item.value === "number" && item.formulaItem === "ADDITION") rows.push({ label, value: `${item.value > 0 ? "+" : ""}${item.value}`, special: false });
      else rows.push({ label: "Efecto especial", value: "Disponible en los datos originales; no convertido a bonificación numérica", special: true });
    }
    else rows.push({ label: "Efecto especial", value: "Disponible en los datos originales; no convertido a bonificación numérica", special: true });
  }
  return rows;
}

export function getRelevantPotentialRanks(profile: Pick<OperatorStatsProfile, "potentialRanks">): number[] {
  const visible = new Set<number>();
  for (const rank of profile.potentialRanks) {
    if (potentialDisplayRows(rank.effects).some((row) => !row.special)) visible.add(rank.rank + 2);
  }
  return [...visible].sort((a, b) => a - b);
}

export function officialPotentialToAppliedRanks(potential: number): number {
  return Math.max(0, Math.trunc(potential) - 1);
}

const numericAttributes = new Set(["maxHp", "atk", "def", "magicResistance", "cost", "blockCnt", "baseAttackTime", "respawnTime", "attackSpeed", "moveSpeed", "hpRecoveryPerSec", "spRecoveryPerSec", "maxDeployCount", "maxDeckStack"]);

function numericRecord(value: unknown): Readonly<Record<string, number>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, entry]) => numericAttributes.has(key) && typeof entry === "number"));
}

export function extractOperatorStatsProfiles(table: unknown, region: StatsRegion, source: OperatorStatsProfile["source"]): OperatorStatsProfile[] {
  if (!table || typeof table !== "object" || Array.isArray(table)) throw new Error("Character table must be an object");
  return Object.entries(table).flatMap(([operatorId, raw]) => {
    if (!operatorId.startsWith("char_") || !raw || typeof raw !== "object" || Array.isArray(raw) || !Array.isArray(raw.phases) || raw.phases.length === 0) return [];
    const record = raw as Record<string, unknown>;
    const phases = (record.phases as unknown[]).map((phase: unknown, index: number) => {
      const item = phase as Record<string, unknown>;
      const frames = Array.isArray(item.attributesKeyFrames) ? item.attributesKeyFrames : [];
      return { phase: index, maxLevel: typeof item.maxLevel === "number" ? item.maxLevel : 0, keyframes: frames.flatMap((frame) => { const entry = frame as Record<string, unknown>; return typeof entry.level === "number" ? [{ level: entry.level, attributes: numericRecord(entry.data) }] : []; }) };
    });
    const favor = Array.isArray(record.favorKeyFrames) ? record.favorKeyFrames.flatMap((frame) => { const entry = frame as Record<string, unknown>; return typeof entry.level === "number" ? [{ level: entry.level, attributes: numericRecord(entry.data) }] : []; }) : [];
    const potentialSource = Array.isArray(record.potentialRanks) ? record.potentialRanks : Object.values(record.potentialRanks ?? {});
    const potentialRanks = potentialSource.map((entry, rank) => { const item = entry as Record<string, unknown>; const buff = item.buff; return { rank, effects: buff ? [buff] : [] }; });
    return [{ operatorId, region, source, phases, favorKeyframes: favor, potentialRanks, modules: [], trait: [] }];
  });
}

export function attachModuleStats(profiles: readonly OperatorStatsProfile[], uniequipTable: unknown, battleTable: unknown, region: StatsRegion): OperatorStatsProfile[] {
  if (!uniequipTable || typeof uniequipTable !== "object" || !battleTable || typeof battleTable !== "object") throw new Error("Module tables must be objects");
  const root = uniequipTable as Record<string, unknown>;
  const battle = battleTable as Record<string, unknown>;
  const charEquip = root.charEquip && typeof root.charEquip === "object" ? root.charEquip as Record<string, unknown> : {};
  const equipDict = root.equipDict && typeof root.equipDict === "object" ? root.equipDict as Record<string, unknown> : {};
  return profiles.map((profile) => {
    const ids = Array.isArray(charEquip[profile.operatorId]) ? charEquip[profile.operatorId] as unknown[] : [];
    const modules = ids.flatMap((value) => {
      if (typeof value !== "string") return [];
      const metadata = equipDict[value] as Record<string, unknown> | undefined;
      const record = battle[value] as Record<string, unknown> | undefined;
      if (!metadata || !record || metadata.charId !== profile.operatorId || !Array.isArray(record.phases)) return [];
      const levels = record.phases.flatMap((phase) => {
        const item = phase as Record<string, unknown>;
        const attrs = Array.isArray(item.attributeBlackboard) ? Object.fromEntries((item.attributeBlackboard as unknown[]).flatMap((entry) => { const attribute = entry as Record<string, unknown>; return typeof attribute.key === "string" && typeof attribute.value === "number" ? [[attribute.key, attribute.value]] : []; })) : {};
        const specialEffects = Array.isArray(item.parts) ? (item.parts as unknown[]).flatMap((part) => { const p = part as Record<string, unknown>; const bundles = [p.addOrOverrideTalentDataBundle, p.overrideTraitDataBundle]; return bundles.flatMap((bundle) => { const b = bundle as Record<string, unknown> | null; const candidates = b && Array.isArray(b.candidates) ? b.candidates as unknown[] : []; return candidates.flatMap((candidate) => { const c = candidate as Record<string, unknown>; return typeof c.additionalDescription === "string" && c.additionalDescription ? [c.additionalDescription] : typeof c.upgradeDescription === "string" && c.upgradeDescription ? [c.upgradeDescription] : []; }); }); }) : [];
        return typeof item.equipLevel === "number" ? [{ level: item.equipLevel, attributes: attrs, specialEffects: [...new Set(specialEffects)] }] : [];
      });
      const moduleType = typeof metadata.typeName1 === "string" && typeof metadata.typeName2 === "string" ? `${metadata.typeName1}-${metadata.typeName2}` : value;
      const typeIcon = typeof metadata.typeIcon === "string" ? metadata.typeIcon : moduleType.toLowerCase();
      return [{ uniEquipId: value, operatorId: profile.operatorId, region, name: typeof metadata.uniEquipName === "string" ? metadata.uniEquipName : value, moduleType, typeIcon, moduleSourceRegion: region, levels }];
    });
    return { ...profile, modules };
  });
}

export function getStatsProfile(manifest: OperatorStatsManifest, operatorId: string, region: StatsRegion): OperatorStatsProfile | null {
  return manifest.profiles.find((profile) => profile.operatorId === operatorId && profile.region === region) ?? null;
}

export type StatsCalculationOptions = Readonly<{
  elite: number;
  level: number;
  trust: number;
  potential: number;
  moduleId?: string | null;
  moduleLevel?: number | null;
}>;

export type StatsCalculationResult = Readonly<{
  phase: number;
  level: number;
  trust: number;
  potential: number;
  base: Readonly<Record<string, number>>;
  trustBonus: Readonly<Record<string, number>>;
  potentialBonus: Readonly<Record<string, number>>;
  moduleBonus: Readonly<Record<string, number>>;
  calculated: Readonly<Record<string, number>>;
  specialEffects: readonly string[];
}>;

const interpolatedAttributes = new Set(["maxHp", "atk", "def", "magicResistance"]);
const moduleAttributeMap: Readonly<Record<string, string>> = { max_hp: "maxHp", atk: "atk", def: "def", magic_resistance: "magicResistance", cost: "cost", block_cnt: "blockCnt", respawn_time: "respawnTime", attack_speed: "attackSpeed" };

export function isModuleRelevantToStats(profile: Pick<OperatorStatsProfile, "phases">, module: OperatorModuleStats): boolean {
  return module.levels.some((level) => Object.entries(level.attributes).some(([key, value]) => {
    const mappedKey = moduleAttributeMap[key];
    if (!mappedKey || value === 0) return false;
    if (mappedKey === "attackSpeed") return profile.phases.some((phase) => phase.keyframes.some((frame) => "baseAttackTime" in frame.attributes));
    return Boolean(displayStatLabels[mappedKey]);
  }));
}

export function getRelevantStatsModules(profile: Pick<OperatorStatsProfile, "phases" | "modules">): OperatorModuleStats[] {
  return profile.modules.filter((module) => isModuleRelevantToStats(profile, module));
}

const moduleVisualSuffixes: Record<string, string> = { A: "α", B: "β", D: "Δ" };

export function formatModuleTypeLabel(label: string): string {
  const separator = label.lastIndexOf("-");
  if (separator < 0) return label;
  const suffix = label.slice(separator + 1);
  return `${label.slice(0, separator + 1)}${moduleVisualSuffixes[suffix] ?? suffix}`;
}
const potentialAttributeMap: Readonly<Record<string, string | undefined>> = { MAX_HP: "maxHp", ATK: "atk", DEF: "def", RES: "magicResistance", COST: "cost", BLOCK: "blockCnt", RESPAWN_TIME: "respawnTime", RESPawn_TIME: "respawnTime", ATTACK_SPEED: "attackSpeed" };

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function interpolateFrames(frames: readonly StatKeyframe[], target: number, continuous: ReadonlySet<string>): Readonly<Record<string, number>> {
  if (!frames.length) return {};
  const ordered = [...frames].sort((a, b) => a.level - b.level);
  const lower = ordered.reduce((current, frame) => frame.level <= target ? frame : current, ordered[0]);
  const upper = ordered.find((frame) => frame.level >= target) ?? ordered[ordered.length - 1];
  const ratio = lower.level === upper.level ? 0 : (target - lower.level) / (upper.level - lower.level);
  const keys = new Set([...Object.keys(lower.attributes), ...Object.keys(upper.attributes)]);
  return Object.fromEntries([...keys].flatMap((key) => {
    const low = lower.attributes[key] ?? 0;
    const high = upper.attributes[key] ?? low;
    return typeof low === "number" && typeof high === "number" ? [[key, continuous.has(key) ? low + (high - low) * ratio : low] as const] : [];
  }));
}

function interpolateBonus(frames: readonly Readonly<{ level: number; attributes: Readonly<Record<string, number>> }>[], target: number): Readonly<Record<string, number>> {
  const maximumFrameLevel = frames.at(-1)?.level ?? 100;
  const scaledTarget = maximumFrameLevel === 0 ? 0 : target * maximumFrameLevel / 100;
  return interpolateFrames(frames, scaledTarget, new Set(frames.flatMap((frame) => Object.keys(frame.attributes))));
}

function addValues(...records: readonly Readonly<Record<string, number>>[]): Readonly<Record<string, number>> {
  const keys = new Set(records.flatMap((record) => Object.keys(record)));
  return Object.fromEntries([...keys].map((key) => [key, records.reduce((sum, record) => sum + (record[key] ?? 0), 0)]));
}

function potentialBonuses(profile: OperatorStatsProfile, potential: number): { numeric: Readonly<Record<string, number>>; special: string[] } {
  const numeric: Record<string, number> = {};
  const special: string[] = [];
  for (const rank of profile.potentialRanks.slice(0, clamp(Math.trunc(potential), 0, profile.potentialRanks.length))) {
    for (const effect of rank.effects) {
      const record = effect && typeof effect === "object" && !Array.isArray(effect) ? effect as Record<string, unknown> : {};
      const attributes = record.attributes && typeof record.attributes === "object" && !Array.isArray(record.attributes) ? record.attributes as Record<string, unknown> : {};
      const modifiers = Array.isArray(attributes.attributeModifiers) ? attributes.attributeModifiers : [];
      for (const modifier of modifiers) {
        const item = modifier && typeof modifier === "object" && !Array.isArray(modifier) ? modifier as Record<string, unknown> : {};
        const key = typeof item.attributeType === "string" ? potentialAttributeMap[item.attributeType] : undefined;
        if (key && item.formulaItem === "ADDITION" && typeof item.value === "number") numeric[key] = (numeric[key] ?? 0) + item.value;
        else special.push("Efecto especial disponible");
      }
      if (!modifiers.length) special.push("Efecto especial disponible");
    }
  }
  return { numeric, special: [...new Set(special)] };
}

export function calculateOperatorStats(profile: OperatorStatsProfile, options: StatsCalculationOptions): StatsCalculationResult {
  const phase = profile.phases[clamp(Math.trunc(options.elite), 0, Math.max(profile.phases.length - 1, 0))];
  if (!phase) throw new Error("Operator has no statistical phases");
  const level = clamp(Math.trunc(options.level), 1, Math.max(phase.maxLevel, 1));
  const trust = clamp(options.trust, 0, 100);
  const base = interpolateFrames(phase.keyframes, level, interpolatedAttributes);
  const trustBonus = interpolateBonus(profile.favorKeyframes, trust);
  const potential = potentialBonuses(profile, options.potential);
  const selectedModule = options.moduleId ? profile.modules.find((module) => module.uniEquipId === options.moduleId) : undefined;
  const selectedLevel = selectedModule && options.moduleLevel != null ? selectedModule.levels.find((item) => item.level === options.moduleLevel) : undefined;
  const moduleBonus = selectedLevel ? Object.fromEntries(Object.entries(selectedLevel.attributes).flatMap(([key, value]) => moduleAttributeMap[key] ? [[moduleAttributeMap[key], value] as const] : [])) : {};
  const calculated: Record<string, number> = { ...addValues(base, trustBonus, potential.numeric, moduleBonus) };
  if ("baseAttackTime" in calculated && "attackSpeed" in calculated && calculated.attackSpeed > 0) calculated.baseAttackTime = calculated.baseAttackTime * 100 / calculated.attackSpeed;
  for (const key of ["maxHp", "atk", "def", "magicResistance"]) if (key in calculated) calculated[key] = Math.round(calculated[key]);
  for (const key of ["cost", "blockCnt", "respawnTime"]) if (key in calculated) calculated[key] = Math.trunc(calculated[key]);
  return { phase: phase.phase, level, trust, potential: clamp(Math.trunc(options.potential), 0, profile.potentialRanks.length), base, trustBonus, potentialBonus: potential.numeric, moduleBonus, calculated, specialEffects: [...potential.special, ...(selectedLevel?.specialEffects ?? [])] };
}
