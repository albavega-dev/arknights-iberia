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

const inGameSuffix = " in-game";
const creditedMarker = "credited as ";

/**
 * Splits a role such as `Skin name; credited as "Studio Montagne" in-game` into the name the game credits and what
 * comes before it (a skin name, or nothing). Null when the role has no such note. Plain string scanning, so the cost
 * stays linear on any wiki text.
 */
export function inGameCredit(role: string): { credited: string; rest: string } | null {
  const trimmed = role.trim();
  const lower = trimmed.toLowerCase();
  if (!lower.endsWith(inGameSuffix)) return null;
  const start = lower.lastIndexOf(creditedMarker);
  if (start === -1) return null;
  const before = trimmed.slice(0, start).trimEnd();
  if (before && !before.endsWith(";") && !before.endsWith(",")) return null;
  let credited = trimmed.slice(start + creditedMarker.length, trimmed.length - inGameSuffix.length).trim();
  if (credited.length > 1 && credited.startsWith('"') && credited.endsWith('"')) credited = credited.slice(1, -1).trim();
  if (!credited) return null;
  return { credited, rest: before.slice(0, before ? -1 : 0).trim() };
}

/**
 * Credit of a line whose wiki note says how the game credits it: the game's name is the credit, and the name the wiki
 * gives stays in the note and the evidence. Without anything else it is the operator art; with a skin name in italics,
 * the art of that skin.
 */
function inGameClassification(artist: Artist, inGame: { credited: string; rest: string }): Omit<NormalizedCredit, "status" | "source" | "evidence"> {
  const notes = `Terra Wiki attributes this art to ${artist.name}; the game credits ${inGame.credited}.`;
  if (!inGame.rest) return { artist: inGame.credited, role: "operator-illustration", notes };
  if (artist.evidence.includes(`''${inGame.rest}`)) return { artist: inGame.credited, role: "promotional-art", outfit: inGame.rest, notes };
  return { artist: inGame.credited, ...roleFor({ ...artist, role: inGame.rest }), notes };
}

export function creditsFor(entry: ArtistCreditEntry): NormalizedCredit[] {
  const credits: NormalizedCredit[] = [];
  const add = (artist: Artist, variant?: "base" | "elite2") => {
    const inGame = artist.role ? inGameCredit(artist.role) : null;
    if (inGame) {
      const credit = inGameClassification(artist, inGame);
      credits.push({ ...credit, ...(variant && !credit.variant ? { variant } : {}), status: entry.status, source: entry.source, evidence: artist.evidence });
      return;
    }
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
