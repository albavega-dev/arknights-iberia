import artistCreditsManifest from "../../data/operator-artist-credits-manifest.json";

type CreditRole = "original-design" | "operator-illustration" | "effects" | "promotional-art" | "collaboration" | "unknown";
type NormalizedCredit = { artist: string; role: CreditRole; variant?: "base" | "elite2"; status: "verified" | "partial" | "pending" };
export type OperatorArtistCreditGroup = { label?: string; artists: string[] };
type LegacyCredit = { name: string };
type ArtistEntry = { operatorId: string; status: "verified" | "partial" | "pending"; credits?: NormalizedCredit[]; general?: LegacyCredit[]; variants?: { base?: LegacyCredit[]; elite2?: LegacyCredit[] } };
const entries = new Map((artistCreditsManifest.entries as ArtistEntry[]).map((entry) => [entry.operatorId, entry]));
function legacyCredits(entry: ArtistEntry): NormalizedCredit[] {
  return [...(entry.general ?? []), ...(entry.variants?.base ?? []), ...(entry.variants?.elite2 ?? [])]
    .flatMap((credit) => credit.name.split("&")).map((artist) => ({ artist: artist.trim(), role: "unknown" as const, status: entry.status })).filter((credit) => credit.artist);
}
function normalizedKey(value: string): string { return value.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase(); }
export function getOperatorArtistCredit(operatorId: string): OperatorArtistCreditGroup[] | null {
  const entry = entries.get(operatorId);
  if (!entry || entry.status === "pending") return null;
  const credits = (entry.credits ?? legacyCredits(entry)).filter((credit) => credit.status !== "pending" && ["unknown", "operator-illustration", "original-design", "effects"].includes(credit.role));
  const groups: OperatorArtistCreditGroup[] = [];
  const seenRoles = new Set<string>();
  const addGroup = (label: string | undefined, artist: string) => {
    const key = normalizedKey(artist);
    const group = groups.find((candidate) => candidate.label === label);
    if (group && group.artists.some((name) => normalizedKey(name) === key)) return;
    if (group) { group.artists.push(artist); return; }
    groups.push({ ...(label ? { label } : {}), artists: [artist] });
  };
  for (const credit of credits) {
    const artistKey = normalizedKey(credit.artist);
    const roleKey = `${artistKey}|${credit.role}|${credit.variant ?? ""}`;
    if (seenRoles.has(roleKey)) continue;
    seenRoles.add(roleKey);
    if (credit.role === "effects") addGroup(credit.variant === "elite2" ? "Efectos E2" : "Efectos", credit.artist);
    else if (credit.role === "original-design") addGroup("Diseño original", credit.artist);
    else addGroup(undefined, credit.artist);
  }
  return groups.length ? groups : null;
}
