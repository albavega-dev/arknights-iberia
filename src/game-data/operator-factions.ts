import factionManifest from "../../data/operator-faction-manifest.json";
import affiliationManifest from "../../data/operator-affiliation-manifest.json";

type FactionManifestEntry = { mainFactionId?: string | null; factionName?: string | null; subPowerPresent?: boolean };
const factionNames = new Map<string, string>();
const operatorMainFactions = new Map<string, string>();
const operatorAdditionalFactions = new Map<string, string[]>();
const mainPowerNationFactionMap: Readonly<Record<string, string>> = {
  columbia: "faction:columbia",
  kjerag: "faction:kjerag",
  lungmen: "faction:lungmen",
};
for (const entry of factionManifest.operators as FactionManifestEntry[]) {
  if (entry.mainFactionId && entry.factionName) factionNames.set(entry.mainFactionId, entry.factionName);
}
for (const entry of factionManifest.operators as Array<FactionManifestEntry & { id?: string }>) {
  if (entry.id && entry.mainFactionId) operatorMainFactions.set(entry.id, entry.mainFactionId);
}
for (const entry of affiliationManifest.associations) {
  if (entry.status !== "verified" || entry.relation !== "sub-power") continue;
  const current = operatorAdditionalFactions.get(entry.operatorId) ?? [];
  if (!current.includes(entry.affiliationId)) current.push(entry.affiliationId);
  operatorAdditionalFactions.set(entry.operatorId, current);
}
for (const entry of factionManifest.operators as Array<FactionManifestEntry & { id?: string; nationId?: string }>) {
  if (!entry.id || !entry.nationId) continue;
  if (entry.subPowerPresent === true) continue;
  const factionId = mainPowerNationFactionMap[entry.nationId];
  if (!factionId) continue;
  const current = operatorAdditionalFactions.get(entry.id) ?? [];
  if (!current.includes(factionId)) current.push(factionId);
  operatorAdditionalFactions.set(entry.id, current);
}
export function getOperatorFactionName(factionId: string): string {
  return factionNames.get(factionId) ?? factionId.replace(/^faction:/, "");
}

export function getOperatorMainFactionId(operatorId: string): string | null {
  return operatorMainFactions.get(operatorId) ?? null;
}

export function getOperatorAdditionalFactionIds(operatorId: string): readonly string[] {
  return operatorAdditionalFactions.get(operatorId) ?? [];
}
