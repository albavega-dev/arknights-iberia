import { compareCodeUnits } from "../src/game-data/string-order";
import { readFile, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import { readDatabaseConfig } from "../src/server/db/config";

type JsonObject = Record<string, unknown>;
type Character = { id: string; position?: unknown; tagList?: unknown; phases?: unknown };
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
const enRevision = required("--en-revision");
const cnRevision = required("--cn-revision");

const object = (value: unknown): JsonObject => value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
const characters = (value: unknown): Map<string, Character> => new Map(Object.entries(object(value)).map(([id, raw]) => {
  const entry = object(raw);
  return [id, { id, position: entry.position, tagList: entry.tagList, phases: entry.phases }];
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
const pool = new Pool(readDatabaseConfig(process.env));
type Row = { id: string };
let rows: Row[];
try { rows = (await pool.query<Row>("select id from public.operators order by id")).rows; } finally { await pool.end(); }

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
const manifest = { manifestVersion: "2026-10-18.1", source: { repository: "ArknightsAssets/ArknightsGamedata", en: { revision: enRevision, characterPath: "en/gamedata/excel/character_table.json", rangePath: "en/gamedata/excel/range_table.json" }, cn: { revision: cnRevision, characterPath: "cn/gamedata/excel/character_table.json", rangePath: "cn/gamedata/excel/range_table.json" } }, rangeDefinitions: Object.fromEntries([...rangeDefinitions].sort(([a], [b]) => a.localeCompare(b))), operators: entries };
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report));
