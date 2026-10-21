import type { OperatorClass } from "./operators";
import illustrationManifest from "../../data/operator-illustration-manifest.json";

const portraitBase = "https://web.hycdn.cn/arknights/game/assets/char/portrait";
const classIconBase = "https://raw.githubusercontent.com/PuppiizSunniiz/Arknight-Images/main";
const factionIconBase = `${classIconBase}/factions`;

// External references only. These assets are not downloaded or redistributed by this repository.
// The source repository does not provide a project license for the game assets; usage remains
// subject to rights-holder approval and may be replaced by an approved provider later.
export type OperatorPortraitAsset = Readonly<{
  url: string;
  objectPosition: string;
  scale: number;
}>;

export type OperatorIllustrationAssets = Readonly<{
  base: string;
  elite2?: string;
}>;

const classPaths: Readonly<Record<OperatorClass, string>> = {
  Guard: "classes/class_guard.png",
  Vanguard: "classes/class_vanguard.png",
  Defender: "classes/class_defender.png",
  Sniper: "classes/class_sniper.png",
  Caster: "classes/class_caster.png",
  Specialist: "classes/class_specialist.png",
  Supporter: "classes/class_supporter.png",
  Medic: "classes/class_medic.png",
};

const factionPaths: Readonly<Record<string, string>> = {
  "faction:abyssal-hunters": "logo_abyssal.png", "faction:aegir": "logo_egir.png", "faction:ave-mujica": "logo_mujica.png", "faction:babel": "logo_babel.png", "faction:blacksteel": "logo_blacksteel.png", "faction:bolivar": "logo_bolivar.png", "faction:chiave-s-gang": "logo_chiave.png", "faction:columbia": "logo_columbia.png", "faction:elite-op": "logo_elite.png", "faction:followers": "logo_followers.png", "faction:glasgow": "logo_glasgow.png", "faction:higashi": "logo_higashi.png", "faction:iberia": "logo_iberia.png", "faction:karlan-trade": "logo_karlan.png", "faction:kazimierz": "logo_kazimierz.png", "faction:kjerag": "logo_kjerag.png", "faction:laios-s-party": "logo_laios.png", "faction:laterano": "logo_laterano.png", "faction:lee-s-detective-agency": "logo_lee.png", "faction:leithanien": "logo_leithanien.png", "faction:lungmen": "logo_lungmen.png", "faction:lungmen-guard-department": "logo_lgd.png", "faction:minos": "logo_minos.png", "faction:op-a4": "logo_action4.png", "faction:op-reserve-a1": "logo_reserve1.png", "faction:op-reserve-a4": "logo_reserve4.png", "faction:op-reserve-a6": "logo_reserve6.png", "faction:penguin-logistics": "logo_penguin.png", "faction:pinus-sylvestris": "logo_pinus.png", "faction:rhine-lab": "logo_rhine.png", "faction:rhodes-island": "logo_rhodes.png", "faction:rim-billiton": "logo_rim.png", "faction:s-e-e-s": "logo_sees.png", "faction:s-w-e-e-p": "logo_sweep.png", "faction:sami": "logo_sami.png", "faction:sargon": "logo_sargon.png", "faction:siesta": "logo_siesta.png", "faction:siracusa": "logo_siracusa.png", "faction:sui": "logo_sui.png", "faction:tara": "logo_tara.png", "faction:team-rainbow": "logo_rainbow.png", "faction:ursus": "logo_ursus.png", "faction:ursus-student-self-governing-group": "logo_student.png", "faction:victoria": "logo_victoria.png", "faction:yan": "logo_yan.png",
};

export function getOperatorPortraitAsset(operatorId: string): OperatorPortraitAsset | null {
  if (!/^char_[a-z0-9_]+$/.test(operatorId)) return null;
  return { url: `${portraitBase}/${operatorId}.png`, objectPosition: "50% 50%", scale: 1 };
}

export function getOperatorIllustrationAssets(operatorId: string): OperatorIllustrationAssets | null {
  const entry = illustrationManifest.operators[operatorId as keyof typeof illustrationManifest.operators] as { base: { url: string }; elite2?: { url: string } } | undefined;
  return entry ? { base: entry.base.url, ...(entry.elite2 ? { elite2: entry.elite2.url } : {}) } : null;
}

export function getOperatorClassIconUrl(operatorClass: OperatorClass): string {
  return `${classIconBase}/${classPaths[operatorClass]}`;
}

export function getOperatorFactionIconUrl(factionId: string | null): string | null {
  const path = factionId ? factionPaths[factionId] : undefined;
  return path ? `${factionIconBase}/${path}` : null;
}

export function getOperatorSubclassIconUrl(subClassId: string | null): string | null {
  if (!subClassId || !/^[a-z0-9]+$/.test(subClassId)) return null;
  return `${classIconBase}/ui/subclass/sub_${subClassId}_icon.png`;
}

export const operatorAssetSource = "https://web.hycdn.cn/arknights/game/assets/char/portrait/";
