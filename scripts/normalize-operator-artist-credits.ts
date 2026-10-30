import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { wikiLinkTargets } from "../src/game-data/wikitext";

type Artist = { name: string; role?: string; evidence: string };
export type ArtistCreditEntry = { operatorId: string; operatorName: string; source: Record<string, unknown>; status: "verified" | "partial" | "pending"; general: Artist[]; variants?: { base?: Artist[]; elite2?: Artist[] }; outfits?: unknown[]; error?: unknown };
export type NormalizedCredit = { artist: string; role: "original-design" | "operator-illustration" | "effects" | "promotional-art" | "collaboration" | "unknown"; variant?: "base" | "elite2"; outfit?: string; status: ArtistCreditEntry["status"]; source: Record<string, unknown>; evidence: string; notes?: string };
export type ArtistCreditsManifest = { schemaVersion: number; purpose?: string; sourcePolicy?: string; entries: ArtistCreditEntry[] };

function splitExplicitArtists(name: string, evidence: string): string[] {
  if (!/\s&\s/.test(name)) return [name.trim()];
  const linkedArtists = wikiLinkTargets(evidence).map((target) => target.trim());
  return linkedArtists.length > 1 ? linkedArtists : [name.trim()];
}

function roleFor(artist: Artist): { role: NormalizedCredit["role"]; variant?: NormalizedCredit["variant"]; outfit?: string; notes?: string } {
  const evidence = artist.evidence;
  const role = artist.role ?? "";
  const design = role.match(/original design(?: by (.*))?/i);
  if (design) return design[1]
    ? { role: "operator-illustration", notes: `Original design credited to ${design[1]}.` }
    : { role: "original-design" };
  if (/effect|E2 artwork|elite\s*2 artwork/i.test(evidence) || /effect/i.test(role)) return { role: "effects", variant: /E2|elite\s*2/i.test(evidence) ? "elite2" : undefined };
  if (/operator art|operator\b/i.test(role)) return { role: "operator-illustration" };
  if (/skin|holiday|trip|delivery|night|path|melodiosa|supernova|ambience|rainbow|storm|overload/i.test(role)) return { role: "promotional-art", outfit: role };
  if (/Twitter\/X/i.test(role) && /Lowro/i.test(evidence)) return { role: "operator-illustration", variant: "elite2", notes: "La evidencia indica que Studio Montagne añadió efectos al arte E2." };
  if (role) return { role: "collaboration", notes: role };
  return { role: "unknown" };
}

export function creditsFor(entry: ArtistCreditEntry): NormalizedCredit[] {
  const credits: NormalizedCredit[] = [];
  const add = (artist: Artist, variant?: "base" | "elite2") => {
    const classification = roleFor(artist);
    for (const name of splitExplicitArtists(artist.name, artist.evidence)) {
      credits.push({ artist: name, ...classification, ...(variant && !classification.variant ? { variant } : {}), status: entry.status, source: entry.source, evidence: artist.evidence });
    }
    const designer = artist.role?.match(/original design by (.+)$/i)?.[1]?.replace(/\[\[|\]\]/g, "").trim();
    if (designer) credits.push({ artist: designer, role: "original-design", ...(variant ? { variant } : {}), status: entry.status, source: entry.source, evidence: artist.evidence });
  };
  if (entry.operatorId === "char_4037_demetr") {
    const evidence = entry.general[0]?.evidence ?? "";
    credits.push({ artist: "Lowro", role: "operator-illustration", variant: "elite2", status: "verified", source: entry.source, evidence, notes: "Source states that Lowro completed the illustration." });
    credits.push({ artist: "Studio Montagne", role: "effects", variant: "elite2", status: "verified", source: entry.source, evidence, notes: "Source states that Studio Montagne added effects to the E2 artwork." });
    return credits;
  }
  for (const artist of entry.general ?? []) add(artist);
  for (const artist of entry.variants?.base ?? []) add(artist, "base");
  for (const artist of entry.variants?.elite2 ?? []) add(artist, "elite2");
  return credits;
}

export function normalizeManifest(manifest: ArtistCreditsManifest): Omit<ArtistCreditsManifest, "entries"> & { entries: (ArtistCreditEntry & { credits: NormalizedCredit[] })[] } {
  const entries = manifest.entries.map((entry) => ({ ...entry, credits: creditsFor(entry) }));
  return { ...manifest, schemaVersion: 2, purpose: "research-only; normalized credits are not connected to UI", entries };
}

async function main(): Promise<void> {
  const input = path.join(process.cwd(), "data/operator-artist-credits-manifest.json");
  const manifest = normalizeManifest(JSON.parse(await readFile(input, "utf8")) as ArtistCreditsManifest);
  await writeFile(input, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ status: "ok", operators: manifest.entries.length, normalizedCredits: manifest.entries.reduce((total, entry) => total + entry.credits.length, 0) }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
