// Registry of the datasets and graphic resources the site serves. The update check and the dataset regeneration walk
// it, so a new dataset or resource type is added here instead of in each tool. Tests check it against the repository.

/** Comparisons the update check can run; each one becomes a key of `existing` in its report, in this order. */
export const changeChecks = {
  operators: { tables: ["character_table"], description: "Name, rarity, class, subclass and phases of each operator" },
  skills: { tables: ["character_table", "skill_table"], description: "Combat skills of the operators" },
  modules: { tables: ["uniequip_table", "battle_equip_table"], description: "Module definitions and their effects" },
  biographies: { tables: ["handbook_info_table"], description: "Handbook entries" },
  base: { tables: ["building_data"], description: "Base skill assignment and the name and description of every stage" },
  ranges: { tables: ["character_table", "range_table"], description: "Attack ranges used by the operators" },
  newGlossaryTerms: { tables: ["gamedata_const"], description: "Glossary terms new in the latest revision" },
} as const;
export type ChangeCheck = keyof typeof changeChecks;

/** Resources whose coverage the update check computes from the latest image tree. */
export type CoverageNeed = "catalogOperators" | "catalogSkillIcons" | "catalogModules";

export type AssetEntry = Readonly<{
  description: string;
  /** Where the files come from: a repository and its directories, or a wiki. */
  source: Readonly<{ repository: string; directories: readonly string[] }> | Readonly<{ wiki: string }>;
  /** Pinned revision: the constant that holds it, or the manifest field. */
  revision: string;
  /** Manifest that lists the files, when there is one. */
  manifest?: string;
  /** Local copies under public/assets; none when the site links to the source. */
  localDirectories: readonly string[];
  /** How the files are refreshed: a package script, or "manual" when they are copied by hand. */
  sync: string;
  /** Files the update check expects in the latest image tree, reported under `reportKey`. */
  coverage?: Readonly<{ reportKey: string; need: CoverageNeed; path: (id: string) => string }>;
}>;

const images = "PuppiizSunniiz/Arknight-Images";

export const assetRegistry = {
  illustrations: { description: "Operator illustrations", source: { repository: images, directories: ["characters"] }, revision: "imageRevision (asset-revisions.ts)", manifest: "data/operator-illustration-manifest.json", localDirectories: [], sync: "assets:generate-illustrations", coverage: { reportKey: "missingIllustrations", need: "catalogOperators", path: (id) => `characters/${id}_1.png` } },
  "skill-icons": { description: "Combat skill icons", source: { repository: images, directories: ["skills"] }, revision: "imageRevision (asset-revisions.ts)", manifest: "data/operator-skill-icons-manifest.json", localDirectories: ["public/assets/operator-skills"], sync: "data:skill-icons:sync", coverage: { reportKey: "missingSkillIcons", need: "catalogSkillIcons", path: (id) => `skills/skill_icon_${id}.png` } },
  "module-art": { description: "Module illustrations and level icons", source: { repository: images, directories: ["equip"] }, revision: "imageRevision (asset-revisions.ts)", manifest: "data/operator-module-art-manifest.json", localDirectories: ["public/assets/operator-modules-art", "public/assets/operator-module-stages"], sync: "data:module-art:sync", coverage: { reportKey: "missingModuleArt", need: "catalogModules", path: (id) => `equip/icon/${id}.png` } },
  "module-type-icons": { description: "Module type icons", source: { repository: images, directories: ["equip"] }, revision: "imageRevision (asset-revisions.ts)", localDirectories: ["public/assets/operator-modules"], sync: "manual" },
  "skill-ui-icons": { description: "Mastery, base skill and base room icons", source: { repository: images, directories: ["ui"] }, revision: "imageRevision (asset-revisions.ts)", manifest: "data/operator-skill-icons-manifest.json", localDirectories: ["public/assets/operator-skill-mastery", "public/assets/operator-base-skills", "public/assets/operator-base-rooms"], sync: "data:skill-icons:sync" },
  "elite-icons": { description: "Promotion icons", source: { repository: images, directories: ["ui"] }, revision: "imageRevision (asset-revisions.ts)", localDirectories: ["public/assets/operator-elite"], sync: "manual" },
  "class-icons": { description: "Class and subclass icons, linked from the source", source: { repository: images, directories: ["ui"] }, revision: "imageRevision (asset-revisions.ts)", localDirectories: [], sync: "none: linked from the source" },
  portraits: { description: "Operator portraits, linked from the source", source: { repository: "fexli/ArknightsResource", directories: ["charpor"] }, revision: "portraitRevision (asset-revisions.ts)", manifest: "data/operator-portrait-manifest.json", localDirectories: [], sync: "scripts/generate-operator-portrait-manifest.ts" },
  "stat-icons": { description: "Attribute icons", source: { wiki: "https://arknights.wiki.gg" }, revision: "none: copied once", localDirectories: ["public/assets/operator-stats"], sync: "manual" },
  "potential-icons": { description: "Potential icons", source: { wiki: "https://arknights.wiki.gg" }, revision: "none: copied once", localDirectories: ["public/assets/operator-potential"], sync: "manual" },
} as const satisfies Record<string, AssetEntry>;
export type AssetId = keyof typeof assetRegistry;

export type DatasetEntry = Readonly<{
  description: string;
  /** Files or directories the generator writes. */
  outputs: readonly string[];
  generator: Readonly<{
    /** Package script. */
    script: string;
    /** "update" generators take --out-dir, --verify-against, --update, --report and --approve; "manual" ones are run by hand. */
    kind: "update" | "manual";
    /** --out-dir, relative to the output root (the repository root for a real update). */
    outDir?: string;
    /** --verify-against, the versioned reference. */
    verifyAgainst?: string;
    /** When a manual generator has to run again. */
    rerunWhen?: readonly ChangeCheck[];
  }>;
  /** GameData tables, read from the snapshot of each region. */
  tables: readonly string[];
  /** Command-line name of a table when it is not the default (`--<region>-<table without _table>`). */
  tableFlags?: Readonly<Record<string, string>>;
  /** Other inputs: manifests and curated files of data/. */
  sources: readonly string[];
  /** Integrity tests that check the versioned dataset. */
  tests: readonly string[];
  /** Comparisons of the update check that affect this dataset. */
  changeChecks: readonly ChangeCheck[];
  /** Graphic resources the dataset needs. */
  assets: readonly AssetId[];
}>;

const catalogManifests = ["data/operator-cn-release-manifest.json", "data/operator-regional-manifest.json"] as const;

export const datasetRegistry = {
  "operator-stats": {
    description: "Stats, traits, potentials and module stats per operator",
    outputs: ["data/operator-stats"],
    generator: { script: "data:stats:generate", kind: "update", outDir: "data/operator-stats", verifyAgainst: "data/operator-stats" },
    tables: ["character_table", "uniequip_table", "battle_equip_table"],
    sources: catalogManifests,
    tests: ["tests/operator-stats-dataset-integrity.test.ts"],
    changeChecks: ["operators", "modules"],
    assets: ["elite-icons", "stat-icons", "potential-icons"],
  },
  "operator-skills": {
    description: "Skills, talents, base skills and skill glossaries per operator",
    outputs: ["data/operator-skills"],
    generator: { script: "data:skills:generate", kind: "update", outDir: "data/operator-skills", verifyAgainst: "data/operator-skills" },
    tables: ["character_table", "skill_table", "range_table", "gamedata_const", "building_data"],
    sources: catalogManifests,
    tests: ["tests/operator-skills-dataset-integrity.test.ts"],
    changeChecks: ["skills", "base", "ranges", "newGlossaryTerms"],
    assets: ["skill-icons", "skill-ui-icons"],
  },
  "operator-modules": {
    description: "Modules, their effects and module glossaries per operator",
    outputs: ["data/operator-modules"],
    generator: { script: "data:modules:generate", kind: "update", outDir: "data/operator-modules", verifyAgainst: "data/operator-modules" },
    tables: ["character_table", "uniequip_table", "battle_equip_table", "range_table", "gamedata_const", "favor_table"],
    sources: [...catalogManifests, "data/operator-module-modes.json"],
    tests: ["tests/operator-modules-dataset-integrity.test.ts"],
    changeChecks: ["modules", "ranges", "newGlossaryTerms"],
    assets: ["module-art", "module-type-icons"],
  },
  "operator-catalog": {
    description: "Operator catalog and biographies; the generator keeps the previous slugs of the versioned catalog and adds the public slug of every renamed operator",
    outputs: ["data/operator-catalog", "data/operator-biographies"],
    generator: { script: "data:catalog:generate", kind: "update", outDir: "data", verifyAgainst: "data" },
    tables: ["character_table", "handbook_info_table"],
    tableFlags: { character_table: "character", handbook_info_table: "handbook" },
    sources: [...catalogManifests, "data/operator-faction-manifest.json", "data/operator-affiliation-manifest.json"],
    tests: ["tests/operator-catalog-dataset-integrity.test.ts"],
    changeChecks: ["operators", "biographies"],
    assets: ["illustrations", "portraits", "class-icons"],
  },
  "operator-tactical-manifest": {
    description: "Base and module ranges with their associated entities",
    outputs: ["data/operator-tactical-manifest.json"],
    generator: { script: "scripts/generate-operator-tactical-manifest.ts", kind: "manual", rerunWhen: ["modules", "ranges"] },
    tables: ["character_table", "range_table"],
    sources: [...catalogManifests, "data/operator-associated-ranges.json", "data/operator-modules"],
    tests: ["tests/operator-tactical-module-ranges.test.ts"],
    changeChecks: ["ranges"],
    assets: [],
  },
  "operator-new-manifests": {
    description: "Name, CN date, faction, affiliations and artist credits of the operators new in CN; proposed and written with data:new-operators --write, then artists:normalize",
    outputs: ["data/operator-regional-manifest.json", "data/operator-faction-manifest.json", "data/operator-affiliation-manifest.json", "data/operator-artist-credits-manifest.json"],
    generator: { script: "data:new-operators", kind: "manual", rerunWhen: ["operators"] },
    tables: ["character_table"],
    sources: [],
    tests: ["tests/new-operator-proposal.test.ts", "tests/operator-catalog-dataset-integrity.test.ts"],
    changeChecks: ["operators"],
    assets: [],
  },
  "operator-global-updates": {
    description: "Global updates that set the NEW badge; proposed with data:global-update for the operators that arrive in Global",
    outputs: ["data/operator-global-updates.json"],
    generator: { script: "data:global-update", kind: "manual" },
    tables: [],
    sources: catalogManifests,
    tests: ["tests/operator-global-updates.test.ts"],
    changeChecks: [],
    assets: [],
  },
} as const satisfies Record<string, DatasetEntry>;
export type DatasetId = keyof typeof datasetRegistry;

/** Curated inputs of data/ that no generator writes; listed so every file of data/ is accounted for. */
export const curatedDataFiles = [
  "data/operator-associated-ranges.json",
  "data/operator-cn-release-manifest.json",
  "data/operator-module-modes.json",
] as const;

const entries = <T>(record: Readonly<Record<string, T>>) => Object.entries(record) as [string, T][];
const unique = <T>(values: readonly T[]) => [...new Set(values)];

/** GameData tables any dataset reads, in the order the registry lists them. */
export function registryTables(): string[] {
  return unique(entries<DatasetEntry>(datasetRegistry).flatMap(([, entry]) => entry.tables));
}

/** Comparisons any dataset needs, in the order of `changeChecks`. */
export function registryChangeChecks(): ChangeCheck[] {
  const used = new Set(entries<DatasetEntry>(datasetRegistry).flatMap(([, entry]) => entry.changeChecks));
  return (Object.keys(changeChecks) as ChangeCheck[]).filter((check) => used.has(check));
}

/** Directories of the image repository that the registered resources come from, in registry order. */
export function registryImageDirectories(repository: string): string[] {
  return unique(entries<AssetEntry>(assetRegistry).flatMap(([, asset]) => ("repository" in asset.source && asset.source.repository === repository ? asset.source.directories : [])));
}

/** Resources with a coverage check, in registry order. */
export function registryCoverage(): Required<AssetEntry>["coverage"][] {
  return entries<AssetEntry>(assetRegistry).flatMap(([, asset]) => (asset.coverage ? [asset.coverage] : []));
}

/** Command-line flag of a table for a dataset generator. */
export function datasetTableFlag(entry: DatasetEntry, region: string, table: string): string {
  return `--${region}-${entry.tableFlags?.[table] ?? table.replace(/_table$/, "").replaceAll("_", "-")}`;
}
