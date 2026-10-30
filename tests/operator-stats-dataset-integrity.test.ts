import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { checkDatasetLimits, statsDatasetContractVersion, validateDatasetIndex, type DatasetIndex } from "../src/game-data/operator-dataset";
import { gameDataRevisions } from "../src/game-data/gamedata-revisions";
import { traitDescriptions, type TraitStage } from "../src/game-data/operator-modules";
import { termIdsOf } from "../src/game-data/operator-skills";
import { parseSkillDescription, type SkillDescriptionNode } from "../src/game-data/skill-description";

const directory = path.resolve("data/operator-stats");
const expectedOperators = 432;

async function readIndex(): Promise<{ index: DatasetIndex; indexBytes: number }> {
  const text = await readFile(path.join(directory, "index.json"));
  return { index: JSON.parse(text.toString("utf8")) as DatasetIndex, indexBytes: text.byteLength };
}

test("stats dataset index is valid and lists every operator with its region", async () => {
  const { index } = await readIndex();
  assert.deepEqual(validateDatasetIndex(index, statsDatasetContractVersion), []);
  const entries = Object.entries(index.operators);
  assert.equal(entries.length, expectedOperators);
  for (const [, entry] of entries) assert.ok(entry.region === "en" || entry.region === "cn");
});

test("stats dataset directory has exactly the indexed files and the index", async () => {
  const { index } = await readIndex();
  const expected = [...Object.values(index.operators).map((entry) => entry.file), "index.json"].sort();
  const actual = (await readdir(directory)).sort();
  assert.deepEqual(actual, expected);
});

test("stats dataset files match the bytes, hash, id and region in the index", async () => {
  const { index } = await readIndex();
  for (const [operatorId, entry] of Object.entries(index.operators)) {
    const content = await readFile(path.join(directory, entry.file));
    assert.equal(content.byteLength, entry.bytes, `${operatorId} bytes`);
    assert.equal(createHash("sha256").update(content).digest("hex").toUpperCase(), entry.sha256.toUpperCase(), `${operatorId} sha256`);
    const profile = JSON.parse(content.toString("utf8")) as { operatorId: string; region: string };
    assert.equal(profile.operatorId, operatorId);
    assert.equal(profile.region, entry.region);
  }
});

test("stats dataset pins the source revisions and stays within its limits", async () => {
  const { index, indexBytes } = await readIndex();
  for (const region of ["en", "cn"] as const) {
    assert.equal(index.sources[region].revision, gameDataRevisions[region]);
    assert.match(index.sources[region].revision, /^[0-9a-f]{40}$/);
  }
  assert.deepEqual(checkDatasetLimits(index, indexBytes).errors, []);
});

const unknownMarkers = (nodes: readonly SkillDescriptionNode[]): string[] => nodes.flatMap((node) => node.type === "unknownMarker" ? [node.text] : node.type === "style" ? unknownMarkers(node.children) : []);

// The Stats card shows the first stage before it unlocks (Ines: one E2 stage that only adds battle data), so a first stage that
// unlocks later must read without its blackboard.
test("every stats file has a readable trait that can be shown from E0, with its terms in the modules glossary", async () => {
  const { index } = await readIndex();
  const glossaries = Object.fromEntries(await Promise.all(["en", "cn"].map(async (region) => [region, JSON.parse(await readFile(path.resolve("data/operator-modules", `glossary-${region}.json`), "utf8")) as { terms: Record<string, unknown> }]))) as Record<string, { terms: Record<string, unknown> }>;
  for (const [operatorId, entry] of Object.entries(index.operators)) {
    const { trait } = JSON.parse(await readFile(path.join(directory, entry.file), "utf8")) as { trait: TraitStage[] };
    assert.ok(trait.length > 0, `${operatorId} has a trait`);
    const first = trait[0]!;
    if (first.unlock.elite > 0 || first.unlock.level > 1 || first.potential > 1) assert.deepEqual(unknownMarkers(parseSkillDescription(first.description, [])), [], `${operatorId} first trait stage before it unlocks`);
    for (const stage of trait) assert.deepEqual(unknownMarkers(parseSkillDescription(stage.description, stage.blackboard ?? [])), [], `${operatorId} trait`);
    for (const id of traitDescriptions(trait).flatMap(termIdsOf)) assert.ok(glossaries[entry.region]!.terms[id], `${id} in the ${entry.region} glossary`);
  }
});
