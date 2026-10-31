import { imageRepository, imageRevision } from "./asset-revisions";
import type { OperatorClass } from "./operators";

// Operator illustrations (characters, converted to WebP), faction logos (factions, converted to WebP) and class and subclass
// icons (classes and ui/subclass, copied as is) from Arknight-Images at the pinned revision.
type FileInfo = { bytes: number; sha256: string; width: number; height: number };
type Conversion = { format: "webp"; maxSize: number; quality: number; alphaQuality: number; effort: number; tool: string };
type Converted = { source: string; url: string; original: FileInfo; converted: FileInfo };
type Copied = { source: string; url: string } & FileInfo;
export type OperatorImageManifest = {
  contractVersion: "1";
  source: { repository: string; revision: string };
  conversions: { illustrations: Conversion; factions: Conversion };
  /** Keyed by local file name (`<operator id>_1.webp` for E0, `<operator id>_2.webp` for E2). */
  illustrations: Record<string, Converted>;
  /** Keyed by local file name (`<faction id without the faction: prefix>.webp`). */
  factions: Record<string, Converted>;
  /** Keyed by local file name (`<class in lower case>.png`). */
  classes: Record<string, Copied>;
  /** Keyed by local file name (`<subclass id>.png`). */
  subclasses: Record<string, Copied>;
};

export const operatorImageSource: OperatorImageManifest["source"] = { repository: imageRepository, revision: imageRevision };
/** Fixed so that a new sync reproduces the committed files byte for byte; the tool version is part of them. */
export const operatorImageConversions: OperatorImageManifest["conversions"] = {
  illustrations: { format: "webp", maxSize: 1280, quality: 80, alphaQuality: 80, effort: 6, tool: "sharp 0.35.5" },
  factions: { format: "webp", maxSize: 96, quality: 90, alphaQuality: 90, effort: 6, tool: "sharp 0.35.5" },
};
export const operatorImageDirectories = { illustrations: "operator-illustrations", factions: "operator-factions", classes: "operator-classes", subclasses: "operator-subclasses" } as const;

/** Source file of each class icon under `classes/`. */
export const classIconFiles: Readonly<Record<OperatorClass, string>> = {
  Guard: "class_guard.png",
  Vanguard: "class_vanguard.png",
  Defender: "class_defender.png",
  Sniper: "class_sniper.png",
  Caster: "class_caster.png",
  Specialist: "class_specialist.png",
  Supporter: "class_supporter.png",
  Medic: "class_medic.png",
};

/** Source file of each faction logo under `factions/`; factions without a logo are not listed. */
export const factionLogoFiles: Readonly<Record<string, string>> = {
  "faction:abyssal-hunters": "logo_abyssal.png", "faction:aegir": "logo_egir.png", "faction:ave-mujica": "logo_mujica.png", "faction:babel": "logo_babel.png", "faction:blacksteel": "logo_blacksteel.png", "faction:bolivar": "logo_bolivar.png", "faction:chiave-s-gang": "logo_chiave.png", "faction:columbia": "logo_columbia.png", "faction:elite-op": "logo_elite.png", "faction:followers": "logo_followers.png", "faction:glasgow": "logo_glasgow.png", "faction:higashi": "logo_higashi.png", "faction:iberia": "logo_iberia.png", "faction:karlan-trade": "logo_karlan.png", "faction:kazimierz": "logo_kazimierz.png", "faction:kjerag": "logo_kjerag.png", "faction:laios-s-party": "logo_laios.png", "faction:laterano": "logo_laterano.png", "faction:lee-s-detective-agency": "logo_lee.png", "faction:leithanien": "logo_leithanien.png", "faction:lungmen": "logo_lungmen.png", "faction:lungmen-guard-department": "logo_lgd.png", "faction:minos": "logo_minos.png", "faction:op-a4": "logo_action4.png", "faction:op-reserve-a1": "logo_reserve1.png", "faction:op-reserve-a4": "logo_reserve4.png", "faction:op-reserve-a6": "logo_reserve6.png", "faction:penguin-logistics": "logo_penguin.png", "faction:pinus-sylvestris": "logo_pinus.png", "faction:rhine-lab": "logo_rhine.png", "faction:rhodes-island": "logo_rhodes.png", "faction:rim-billiton": "logo_rim.png", "faction:s-e-e-s": "logo_sees.png", "faction:s-w-e-e-p": "logo_sweep.png", "faction:sami": "logo_sami.png", "faction:sargon": "logo_sargon.png", "faction:siesta": "logo_siesta.png", "faction:siracusa": "logo_siracusa.png", "faction:sui": "logo_sui.png", "faction:tara": "logo_tara.png", "faction:team-rainbow": "logo_rainbow.png", "faction:ursus": "logo_ursus.png", "faction:ursus-student-self-governing-group": "logo_student.png", "faction:victoria": "logo_victoria.png", "faction:yan": "logo_yan.png",
};

const operatorIdPattern = /^char_[a-z0-9_]+$/;
const subclassIdPattern = /^[a-z0-9]+$/;

/** One file to fetch: its path in the image repository and its local file name. */
export type ImageItem = Readonly<{ source: string; local: string }>;
export type OperatorImageInventory = Readonly<{
  /** E0 illustration of every operator, and E2 when the pinned tree has one. */
  illustrations: readonly ImageItem[];
  factions: readonly ImageItem[];
  classes: readonly ImageItem[];
  subclasses: readonly ImageItem[];
}>;

/** Files the sync fetches for the catalog: every operator needs its E0 illustration and its subclass icon. */
export function operatorImageInventory(operators: readonly { id: string; class: OperatorClass; subClassId: string }[], tree: ReadonlySet<string>): OperatorImageInventory {
  const ids = operators.map((operator) => operator.id);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate operator ids in the catalog");
  const byName = (a: ImageItem, b: ImageItem) => (a.local < b.local ? -1 : a.local > b.local ? 1 : 0);
  const illustrations: ImageItem[] = [];
  for (const id of ids) {
    if (!operatorIdPattern.test(id)) throw new Error(`Invalid operator id: ${JSON.stringify(id)}`);
    illustrations.push({ source: `characters/${id}_1.png`, local: `${id}_1.webp` });
    if (tree.has(`characters/${id}_2.png`)) illustrations.push({ source: `characters/${id}_2.png`, local: `${id}_2.webp` });
  }
  const subclassIds = [...new Set(operators.map((operator) => operator.subClassId))];
  for (const id of subclassIds) if (!subclassIdPattern.test(id)) throw new Error(`Invalid subclass id: ${JSON.stringify(id)}`);
  return {
    illustrations: illustrations.sort(byName),
    factions: Object.entries(factionLogoFiles).map(([id, file]) => ({ source: `factions/${file}`, local: `${id.slice("faction:".length)}.webp` })).sort(byName),
    classes: Object.entries(classIconFiles).map(([name, file]) => ({ source: `classes/${file}`, local: `${name.toLowerCase()}.png` })).sort(byName),
    subclasses: subclassIds.map((id) => ({ source: `ui/subclass/sub_${id}_icon.png`, local: `${id}.png` })).sort(byName),
  };
}
