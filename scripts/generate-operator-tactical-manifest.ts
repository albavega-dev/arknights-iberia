import { gameDataRepository, gameDataRevisions } from "../src/game-data/gamedata-revisions";
import { assetPath } from "../src/game-data/asset-paths";
import { compareCodeUnits } from "../src/game-data/string-order";
import { readFile, writeFile } from "node:fs/promises";
import { readCatalog } from "./operator-dataset-io";

type JsonObject = Record<string, unknown>;
type Character = { id: string; name?: unknown; position?: unknown; tagList?: unknown; phases?: unknown };
type ModuleProfile = {
  operatorId: string;
  region: "en" | "cn";
  ranges: Record<string, { direction?: unknown; grids?: unknown }>;
  modules: { id: string; type: string; icon: string; levels: { level: number; rangeId?: string }[] }[];
};
type AssociatedRangeRecord = { rangeKey: string };
type Range = { id?: unknown; direction?: unknown; grids?: unknown };

const argumentPairs: [string, string][] = [];
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index];
  if (name?.startsWith("--")) argumentPairs.push([name, process.argv[index + 1] ?? ""]);
}
const args = new Map<string, string>(argumentPairs);
const required = (name: string): string => {
  const value = args.get(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const enCharacterPath = required("--en-character");
const enRangePath = required("--en-range");
const cnCharacterPath = required("--cn-character");
const cnRangePath = required("--cn-range");
const outputPath = required("--output");
const reportPath = required("--report");
const enRevision = args.get("--en-revision") ?? gameDataRevisions.en;
const cnRevision = args.get("--cn-revision") ?? gameDataRevisions.cn;
const releaseManifestPath = args.get("--release-manifest") ?? "data/operator-cn-release-manifest.json";
const regionalManifestPath = args.get("--regional-manifest") ?? "data/operator-regional-manifest.json";
const modulesDirectory = args.get("--modules-dir") ?? "data/operator-modules";
const associatedRangesPath = args.get("--associated-ranges") ?? "data/operator-associated-ranges.json";

const object = (value: unknown): JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
const characters = (value: unknown): Map<string, Character> => new Map(Object.entries(object(value)).map(([id, raw]) => {
  const entry = object(raw);
  return [id, { id, name: entry.name, position: entry.position, tagList: entry.tagList, phases: entry.phases }];
}));
const ranges = (value: unknown): Map<string, Range> => new Map(Object.entries(object(value)).map(([id, raw]) => {
  const entry = object(raw);
  return [id, { id: entry.id ?? id, direction: entry.direction, grids: entry.grids }];
}));
const phaseList = (value: unknown): JsonObject[] => Array.isArray(value) ? value.map(object) : [];
const grids = (value: unknown): { row: number; col: number }[] | null => {
  if (!Array.isArray(value)) return null;
  const result = value.map(object).map((grid) => ({ row: grid.row, col: grid.col }));
  return result.every((grid) => Number.isInteger(grid.row) && Number.isInteger(grid.col))
    ? result as { row: number; col: number }[]
    : null;
};

const [enCharacter, enRange, cnCharacter, cnRange] = await Promise.all([
  readFile(enCharacterPath, "utf8").then(JSON.parse), readFile(enRangePath, "utf8").then(JSON.parse),
  readFile(cnCharacterPath, "utf8").then(JSON.parse), readFile(cnRangePath, "utf8").then(JSON.parse),
]);
const en = characters(enCharacter); const cn = characters(cnCharacter);
const enRanges = ranges(enRange); const cnRanges = ranges(cnRange);
const rows = [...(await readCatalog(releaseManifestPath, regionalManifestPath)).keys()].sort(compareCodeUnits).map((id) => ({ id }));

const positionValues = new Set<string>();
const rangeDefinitions = new Map<string, { direction: number | null; grids: { row: number; col: number }[] }>();
const entries = rows.map(({ id }) => {
  const source = en.get(id) ? { region: "en" as const, character: en.get(id)!, rangeMap: enRanges, revision: enRevision } : cn.get(id) ? { region: "cn" as const, character: cn.get(id)!, rangeMap: cnRanges, revision: cnRevision } : undefined;
  if (!source) return { id, source: null, position: null, phases: [] };
  const position = typeof source.character.position === "string" ? source.character.position : null;
  if (position) positionValues.add(position);
  const phases = phaseList(source.character.phases).map((phase, index) => {
    const rangeId = typeof phase.rangeId === "string" ? phase.rangeId : null;
    const range = rangeId ? source.rangeMap.get(rangeId) : undefined;
    const coordinates = range ? grids(range.grids) : null;
    if (rangeId && range && coordinates) rangeDefinitions.set(`${source.region}:${rangeId}`, { direction: typeof range.direction === "number" ? range.direction : null, grids: coordinates });
    return { phase: index, rangeId, rangeKey: rangeId && range && coordinates ? `${source.region}:${rangeId}` : null };
  });
  const tags = Array.isArray(source.character.tagList) && source.character.tagList.every((tag) => typeof tag === "string") ? source.character.tagList : [];
  return { id, source: { region: source.region, revision: source.revision }, position, tags, phases };
});

// Ranges of associated entities and substitutes come from the curation file; their geometry is read from the range tables.
const associated = JSON.parse(await readFile(associatedRangesPath, "utf8")) as Record<"substitutes" | "entities", Record<string, AssociatedRangeRecord[]>>;
for (const record of [...Object.values(associated.substitutes), ...Object.values(associated.entities)].flat()) {
  const [region, rangeId] = record.rangeKey.split(":") as ["en" | "cn", string];
  const range = (region === "en" ? enRanges : cnRanges).get(rangeId);
  const coordinates = range ? grids(range.grids) : null;
  if (!range || !coordinates) throw new Error(`Associated range ${record.rangeKey} is not in the ${region} range table`);
  rangeDefinitions.set(record.rangeKey, { direction: typeof range.direction === "number" ? range.direction : null, grids: coordinates });
}

// Modules whose levels change the attack range, sorted by operator and module.
const moduleRanges = [];
for (const { id } of rows) {
  const profile = JSON.parse(await readFile(`${modulesDirectory}/${id}.json`, "utf8")) as ModuleProfile;
  for (const equipment of profile.modules) {
    const changed = equipment.levels.filter((level) => level.rangeId);
    if (!changed.length) continue;
    const modifiedRangeId = changed[0]!.rangeId!;
    if (changed.length !== equipment.levels.length || changed.some((level) => level.rangeId !== modifiedRangeId)) throw new Error(`Module ${equipment.id} does not change the range uniformly across its levels`);
    const baseRangeId = entries.find((entry) => entry.id === id)?.phases.at(-1)?.rangeId;
    const coordinates = grids(profile.ranges[modifiedRangeId]?.grids);
    const name = en.get(id)?.name;
    if (!baseRangeId || !coordinates) throw new Error(`Module ${equipment.id} has no resolvable base range or geometry`);
    if (profile.region !== "en" || typeof name !== "string") throw new Error(`Module ${equipment.id} has no EN name to build its evidence link`);
    moduleRanges.push({
      operatorId: id,
      uniEquipId: equipment.id,
      moduleType: equipment.type,
      level: equipment.levels[0]!.level,
      mechanism: "rangeId",
      baseRangeId,
      modifiedRangeId,
      rangeKey: `module:${equipment.type.toLowerCase()}-${id.split("_").slice(2).join("_")}`,
      grids: coordinates,
      iconUrl: assetPath("operator-modules", `${equipment.icon}.png`),
      evidenceUrl: `https://arknights.wiki.gg/wiki/${encodeURIComponent(name.replaceAll(" ", "_")).replaceAll("'", "%27")}`,
      source: { region: profile.region, revision: enRevision },
    });
  }
}
moduleRanges.sort((a, b) => compareCodeUnits(a.operatorId, b.operatorId) || compareCodeUnits(a.uniEquipId, b.uniEquipId));

// One entry per line, as in the committed file, so that module ranges stay easy to review.
const inline = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(inline).join(", ")}]`
  : value && typeof value === "object" ? `{ ${Object.entries(value).map(([key, item]) => `"${key}": ${inline(item)}`).join(", ")} }` : JSON.stringify(value);
const moduleRangesMarker = "__MODULE_RANGES__";
const moduleRangesText = `[\n${moduleRanges.map((entry) => `    ${inline(entry)}`).join(",\n")}\n  ]`;

const report = {
  audited: rows.length,
  foundEn: entries.filter((entry) => entry.source?.region === "en").length,
  foundCnOnly: entries.filter((entry) => entry.source?.region === "cn").length,
  missing: entries.filter((entry) => !entry.source).map((entry) => entry.id),
  positionMissing: entries.filter((entry) => entry.source && entry.position === null).map((entry) => entry.id),
  positionValues: [...positionValues].sort(compareCodeUnits),
  phasesWithoutRangeId: entries.flatMap((entry) => entry.phases.filter((phase) => phase.rangeId === null).map((phase) => ({ id: entry.id, phase: phase.phase }))),
  unresolvedRanges: entries.flatMap((entry) => entry.phases.filter((phase) => phase.rangeId !== null && phase.rangeKey === null).map((phase) => ({ id: entry.id, phase: phase.phase, rangeId: phase.rangeId }))),
  rangeDefinitions: rangeDefinitions.size,
};
const manifest = { manifestVersion: "2026-10-18.1", source: { repository: gameDataRepository, en: { revision: enRevision, characterPath: "en/gamedata/excel/character_table.json", rangePath: "en/gamedata/excel/range_table.json" }, cn: { revision: cnRevision, characterPath: "cn/gamedata/excel/character_table.json", rangePath: "cn/gamedata/excel/range_table.json" } }, moduleRanges: moduleRangesMarker, rangeDefinitions: Object.fromEntries([...rangeDefinitions].sort(([a], [b]) => a.localeCompare(b))), operators: entries };
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2).replace(JSON.stringify(moduleRangesMarker), () => moduleRangesText)}\n`, "utf8");
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report));
