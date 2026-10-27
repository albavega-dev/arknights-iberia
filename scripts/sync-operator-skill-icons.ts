import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gameDataSkillTableHashes, type GameDataRegion } from "../src/game-data/gamedata-revisions";
import { masteryIconFiles, masteryIconsSourceDirectory, skillIconLocalName, skillIconsContractVersion, resolveSkillIconSource, type SkillIconEntry, type SkillIconsManifest } from "../src/game-data/operator-skill-icons";
import { serializeDatasetJson } from "../src/game-data/operator-dataset";
import { arg, exists, readJson, sha256, tableFlag } from "./operator-dataset-io";
import { readSkillsDataset } from "./generate-operator-skills";

const regions: readonly GameDataRegion[] = ["en", "cn"];
export const skillIconsRepository = "PuppiizSunniiz/Arknight-Images";
export const skillIconsDirectory = "skills";
const revisionPattern = /^[0-9a-f]{40}$/;

export type SkillRecord = Readonly<{ region: GameDataRegion; skillId: string }>;
type SkillTable = Readonly<Record<string, { iconId?: string | null } | undefined>>;
export type PngFile = Readonly<{ bytes: number; sha256: string; width: number; height: number }>;

export function pngInfo(data: Buffer): PngFile {
  if (data.length < 24 || data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("Not a PNG file");
  return { bytes: data.length, sha256: sha256(data), width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

/** Pure part of the sync: which inventoried file serves each catalog skill, and which skills have none. */
export function resolveCatalogIcons(skills: readonly SkillRecord[], skillTables: Readonly<Record<GameDataRegion, SkillTable>>, inventory: ReadonlySet<string>) {
  const bySkill: Record<GameDataRegion, Record<string, string>> = { en: {}, cn: {} };
  const missing: Record<GameDataRegion, string[]> = { en: [], cn: [] };
  const sources = new Set<string>();
  for (const { region, skillId } of skills) {
    const source = resolveSkillIconSource(skillId, skillTables[region][skillId]?.iconId, inventory);
    if (!source) { if (!missing[region].includes(skillId)) missing[region].push(skillId); continue; }
    bySkill[region][skillId] = skillIconLocalName(source);
    sources.add(source);
  }
  for (const region of regions) missing[region].sort((a, b) => a.localeCompare(b, "en"));
  return { bySkill, missing, sources: [...sources].sort((a, b) => a.localeCompare(b, "en")) };
}

export function buildSkillIconsManifest(revision: string, resolved: ReturnType<typeof resolveCatalogIcons>, files: ReadonlyMap<string, PngFile>, masteryFiles: ReadonlyMap<string, PngFile>): SkillIconsManifest {
  if (!revisionPattern.test(revision)) throw new Error("The revision must be a full 40-character commit hash");
  const entry = (directory: string, source: string, info: PngFile | undefined): SkillIconEntry => {
    if (!info) throw new Error(`Missing downloaded file: ${directory}/${source}`);
    return { source: `${directory}/${source}`, url: `https://raw.githubusercontent.com/${skillIconsRepository}/${revision}/${directory}/${encodeURIComponent(source)}`, ...info };
  };
  const icons: Record<string, SkillIconEntry> = {};
  for (const source of resolved.sources) icons[skillIconLocalName(source)] = entry(skillIconsDirectory, source, files.get(source));
  const mastery = Object.fromEntries(masteryIconFiles.map((file) => [file, entry(masteryIconsSourceDirectory, file, masteryFiles.get(file))]));
  const sort = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b, "en")));
  return {
    contractVersion: skillIconsContractVersion,
    source: { repository: skillIconsRepository, revision, directory: skillIconsDirectory },
    icons: sort(icons),
    skills: { en: sort(resolved.bySkill.en), cn: sort(resolved.bySkill.cn) },
    missing: resolved.missing,
    mastery,
  };
}

export async function main(argv: readonly string[] = process.argv): Promise<void> {
  const revision = arg("--revision", argv);
  const sourceDir = arg("--source-dir", argv);
  const skillsDir = arg("--skills-dir", argv);
  const outManifest = arg("--out-manifest", argv);
  const outAssets = arg("--out-assets", argv);
  const masteryDir = arg("--mastery-dir", argv);
  const outMasteryAssets = arg("--out-mastery-assets", argv);
  const force = argv.includes("--force");
  if ((await exists(outManifest) || await exists(outAssets) || await exists(outMasteryAssets)) && !force) throw new Error("Output exists; pass --force to overwrite");
  const skillTables = {} as Record<GameDataRegion, SkillTable>;
  for (const region of regions) {
    const path = arg(tableFlag(region, "skill_table"), argv);
    if (sha256(await readFile(path)) !== gameDataSkillTableHashes[region].skill_table) throw new Error(`Snapshot SHA-256 mismatch: ${tableFlag(region, "skill_table")}`);
    skillTables[region] = await readJson(path) as SkillTable;
  }
  const { profiles } = await readSkillsDataset(skillsDir);
  const skills = profiles.flatMap((profile) => profile.skills.map((skill) => ({ region: profile.region as GameDataRegion, skillId: skill.skillId })));
  const inventory = new Set((await readdir(sourceDir)).filter((name) => name.endsWith(".png")));
  const resolved = resolveCatalogIcons(skills, skillTables, inventory);
  const files = new Map<string, PngFile>();
  for (const source of resolved.sources) files.set(source, pngInfo(await readFile(join(sourceDir, source))));
  const masteryFiles = new Map<string, PngFile>();
  for (const file of masteryIconFiles) masteryFiles.set(file, pngInfo(await readFile(join(masteryDir, file))));
  const manifest = buildSkillIconsManifest(revision, resolved, files, masteryFiles);
  await mkdir(outAssets, { recursive: true });
  for (const source of resolved.sources) await copyFile(join(sourceDir, source), join(outAssets, skillIconLocalName(source)));
  await mkdir(outMasteryAssets, { recursive: true });
  for (const file of masteryIconFiles) await copyFile(join(masteryDir, file), join(outMasteryAssets, file));
  await writeFile(outManifest, serializeDatasetJson(manifest), "utf8");
  const covered = { en: Object.keys(manifest.skills.en).length, cn: Object.keys(manifest.skills.cn).length };
  console.log(`Copied ${resolved.sources.length} icons; skills with icon EN ${covered.en}, CN ${covered.cn}; without icon EN ${manifest.missing.en.length}, CN ${manifest.missing.cn.length}`);
}

if (process.argv[1]?.endsWith("sync-operator-skill-icons.ts")) main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
