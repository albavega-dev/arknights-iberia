import { readFile } from "node:fs/promises";
import { getConfirmedModuleRanges } from "../src/game-data/operator-tactical";

type Grid = { row: number; col: number };
type JsonObject = Record<string, unknown>;

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!, process.argv[i + 1] ?? "");
const required = (name: string) => {
  const value = args.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const legacyModules = [
  { operatorId: "char_2015_dusk", moduleId: "uniequip_002_dusk", type: "SPC-X", mechanism: "rangeId" },
  { operatorId: "char_109_fmout", moduleId: "uniequip_002_fmout", type: "SPC-X", mechanism: "rangeId" },
  { operatorId: "char_1011_lava2", moduleId: "uniequip_002_lava2", type: "SPC-X", mechanism: "rangeId" },
  { operatorId: "char_373_lionhd", moduleId: "uniequip_002_lionhd", type: "SPC-X", mechanism: "rangeId" },
  { operatorId: "char_213_mostma", moduleId: "uniequip_003_mostma", type: "SPC-X", mechanism: "rangeId" },
  { operatorId: "char_128_plosis", moduleId: "uniequip_002_plosis", type: "RIN-X", mechanism: "rangeId" },
  { operatorId: "char_179_cgbird", moduleId: "uniequip_002_cgbird", type: "RIN-X", mechanism: "rangeId" },
  { operatorId: "char_275_breeze", moduleId: "uniequip_002_breeze", type: "RIN-X", mechanism: "rangeId" },
  { operatorId: "char_4164_tecno", moduleId: "uniequip_002_tecno", type: "SOC-Y", mechanism: "rangeId" },
  { operatorId: "char_1034_jesca2", moduleId: "uniequip_003_jesca2", type: "SPT-Y", mechanism: "forwardExtend" },
  { operatorId: "char_4194_rmixer", moduleId: "uniequip_003_rmixer", type: "SPT-Y", mechanism: "forwardExtend" },
] as const;

const object = (value: unknown): JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
const gridList = (value: unknown): Grid[] | null => {
  if (!Array.isArray(value)) return null;
  const result = value.map(object).map((v) => ({ row: v.row, col: v.col }));
  return result.every((v) => Number.isInteger(v.row) && Number.isInteger(v.col)) ? result as Grid[] : null;
};
const key = (grid: Grid) => `${grid.row},${grid.col}`;
const normalized = (grids: ReadonlyArray<Grid>) => [...new Set(grids.map(key))].sort();
const collectRangeIds = (value: unknown, result = new Set<string>()): Set<string> => {
  if (Array.isArray(value)) value.forEach((item) => collectRangeIds(item, result));
  else if (value && typeof value === "object") {
    for (const [name, child] of Object.entries(value)) {
      if (name === "rangeId" && typeof child === "string") result.add(child);
      else collectRangeIds(child, result);
    }
  }
  return result;
};

const [identity, battle, ranges] = await Promise.all([
  readFile(required("--identity"), "utf8").then(JSON.parse),
  readFile(required("--battle"), "utf8").then(JSON.parse),
  readFile(required("--range"), "utf8").then(JSON.parse),
]);
const tactical = await readFile(args.get("--tactical") ?? "data/operator-tactical-manifest.json", "utf8").then(JSON.parse);
const manifestModules = Array.isArray(object(tactical).moduleRanges)
  ? (object(tactical).moduleRanges as unknown[]).map(object).map((module) => ({
      operatorId: String(module.operatorId),
      moduleId: String(module.uniEquipId),
      type: String(module.moduleType),
      mechanism: module.mechanism === "ability_range_forward_extend" ? "forwardExtend" : "rangeId",
    }))
  : [];
const modules = [...legacyModules, ...manifestModules];
const identityMap = object(object(identity).equipDict);
const rangeMap = object(ranges);
const errors: string[] = [];
const excludedModuleIds = ["uniequip_002_tachak", "uniequip_004_archet"];
const associatedRangeOperators = new Set(["char_1023_ghost2", "char_369_bena", "char_4016_kazema", "char_4107_vrdant", "char_4124_iana", "char_4183_mortis"]);
for (const excluded of excludedModuleIds) {
  if (manifestModules.some((module) => module.moduleId === excluded)) errors.push("excluded module is present: " + excluded);
}
const blackboardValues = (value: unknown, wantedKey: string): number[] => {
  const result: number[] = [];
  const visit = (node: unknown, inOverrideTrait = false) => {
    if (Array.isArray(node)) return node.forEach((item) => visit(item, inOverrideTrait));
    if (!node || typeof node !== "object") return;
    for (const [name, child] of Object.entries(node)) {
      if (name === "overrideTraitDataBundle") visit(child, true);
      else if (inOverrideTrait && name === "blackboard" && Array.isArray(child)) {
        for (const entry of child) {
          const item = object(entry);
          if (item.key === wantedKey && typeof item.value === "number") result.push(item.value);
        }
      } else visit(child, inOverrideTrait);
    }
  };
  visit(value);
  return result;
};
const baseRangeId = (operatorId: string): string | null => {
  const entry = Array.isArray(object(tactical).operators)
    ? (object(tactical).operators as unknown[]).map(object).find((item) => item.id === operatorId)
    : null;
  const phases = entry && Array.isArray(entry.phases) ? entry.phases : [];
  const phase = phases.map(object).find((item) => item.phase === 2) ?? phases.map(object)[phases.length - 1];
  return phase && typeof phase.rangeId === "string" ? phase.rangeId : null;
};
const deriveForwardExtension = (base: Grid[], amount: number): Grid[] | null => {
  if (!Number.isInteger(amount) || amount < 0) return null;
  const rows = new Set(base.map((grid) => grid.row));
  if (rows.size !== 1 || base.length === 0) return null;
  const cols = [...new Set(base.map((grid) => grid.col))].sort((a, b) => a - b);
  if (cols.some((col, index) => index > 0 && col !== cols[index - 1]! + 1)) return null;
  const row = base[0]!.row;
  return [...base, ...Array.from({ length: amount }, (_, index) => ({ row, col: cols[cols.length - 1]! + index + 1 }))];
};
const rows = modules.map(({ operatorId, moduleId, type, mechanism }) => {
  const identityEntry = object(identityMap[moduleId]);
  const moduleData = object(battle)[moduleId];
  const local = getConfirmedModuleRanges(operatorId).find((entry) => entry.moduleId === moduleId);
  const ownerType = associatedRangeOperators.has(operatorId) ? "substitute" : "operator";
  const available = Object.entries(identityMap).filter(([, value]) => object(value).charId === operatorId).map(([id, value]) => ({ id, name: object(value).uniEquipName, icon: object(value).uniEquipIcon }));
  if (!Object.keys(identityEntry).length) errors.push(operatorId + ": missing module " + moduleId);
  if (identityEntry.charId !== operatorId) errors.push(operatorId + ": " + moduleId + " belongs to " + String(identityEntry.charId));
  const phases: unknown[] = Array.isArray(object(moduleData).phases) ? object(moduleData).phases as unknown[] : [];
  const stageRangeIds = phases.map((phase: unknown) => ({
    stage: object(phase).equipLevel ?? null,
    rangeIds: [...collectRangeIds(phase)],
  }));
  const ids = new Set(stageRangeIds.flatMap((entry) => entry.rangeIds));
  const extensionValues = phases.map((phase) => [...new Set(blackboardValues(phase, "ability_range_forward_extend"))]);
  const extension = [...new Set(extensionValues.flat())];
  if (mechanism === "rangeId" && ids.size === 0) errors.push(operatorId + ": " + moduleId + " lacks a structured rangeId");
  if (mechanism === "forwardExtend" && (extension.length !== 1 || extension[0] !== 1)) errors.push(operatorId + ": " + moduleId + " lacks ability_range_forward_extend=1");
  if (mechanism === "none" && (ids.size > 0 || extension.length > 0)) errors.push(operatorId + ": " + moduleId + " unexpectedly exposes a static range mechanism");
  const baseId = baseRangeId(operatorId);
  const baseGrids = baseId ? gridList(object(object(rangeMap)[baseId]).grids) : null;
  const derivedGrids = extension.length === 1 && baseGrids ? deriveForwardExtension(baseGrids, extension[0]!) : null;
  if (extension.length > 1) errors.push(operatorId + ": inconsistent ability_range_forward_extend values");
  if (extension.length === 1 && !derivedGrids) errors.push(operatorId + ": unsupported forward-extension base geometry");
  const original = [...ids].map((rangeId) => ({ rangeId, grids: gridList(object(object(rangeMap)[rangeId]).grids) })).filter((entry) => entry.grids);
  const comparisons = ownerType === "substitute" ? [] : original.map(({ rangeId, grids }) => {
    const localKeys = local ? normalized(local.grids) : [];
    const originalKeys = normalized(grids!);
    const match = JSON.stringify(localKeys) === JSON.stringify(originalKeys);
    if (!match) errors.push(operatorId + ": " + moduleId + " differs from " + rangeId);
    return { rangeId, match, missing: originalKeys.filter((v) => !localKeys.includes(v)), added: localKeys.filter((v) => !originalKeys.includes(v)) };
  });
  if (!ids.size && derivedGrids) {
    const localKeys = local ? normalized(local.grids) : [];
    const originalKeys = normalized(derivedGrids);
    const match = JSON.stringify(localKeys) === JSON.stringify(originalKeys);
    if (!match) errors.push(operatorId + ": differs from derived ability_range_forward_extend geometry");
    return { operatorId, moduleId, expectedType: type, typeEvidence: "explicit audit mapping; not a raw JSON field", availableModules: available, stageRangeIds, originalRangeIds: [], baseRangeId: baseId, transformation: { key: "ability_range_forward_extend", values: extension, derivedGrids, match }, comparisons, classification: "numeric-derived" };
  }
  return { operatorId, moduleId, expectedType: type, ownerType, typeEvidence: "explicit audit mapping; not a raw JSON field", availableModules: available, stageRangeIds, originalRangeIds: [...ids], comparisons, classification: ownerType === "substitute" ? "entity-numeric" : ids.size ? "numeric" : "identity-verified-no-rangeId" };
});
console.log(JSON.stringify({ source: { identityPath: args.get("--identity"), battlePath: args.get("--battle"), rangePath: args.get("--range") }, errors, modules: rows }, null, 2));
if (errors.length) process.exitCode = 1;
