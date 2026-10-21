import assert from "node:assert/strict";
import test from "node:test";
import { bundleSha256, validateOperatorBundle, type OperatorBundle } from "../src/game-data/operator-bundle";
import { arg, main as generateBundleMain, source as generatorSource } from "../scripts/generate-operator-bundle";

const op = (id = "char_test", slug = "operator-test") => ({ id, name: "Test", cnName: null, globalName: null, class: "Guard" as const, subClassId: "swordmaster", rarity: 6 as const, slug, cnOnly: false, availabilityStatus: "global-snapshot" as const, cnReleaseDate: null, globalReleaseDate: null, mainPowerNationId: null, mainPowerGroupId: null, mainPowerTeamId: null, mainFactionId: null });
const source = { repository: "example/repo", revision: "a".repeat(40), path: "character_table.json", sha256: "b".repeat(64) };
const make = (overrides: Partial<OperatorBundle> = {}): OperatorBundle => { const base = { contractVersion: "1" as const, sources: { en: source, cn: source }, biographySources: { en: source, cn: source }, operators: [op()], biographies: [], coverage: { operators: 1, biographies: { en: 0, cn: 0, total: 0 } } }; const body = { ...base, ...overrides }; return { ...body, integrity: { algorithm: "sha256" as const, sha256: bundleSha256(body) } }; };

test("accepts a valid bundle with optional biographies absent", () => assert.equal(validateOperatorBundle(make()).ok, true));
test("accepts CN release metadata without changing the v1 contract", () => {
  const dated = { ...op(), cnReleaseDate: "2026-01-01", cnReleaseDateStatus: "verified" as const, cnReleaseDateSource: "https://example.test/releases" };
  const base = Object.fromEntries(Object.entries(make()).filter(([key]) => key !== "integrity")) as Omit<OperatorBundle, "integrity">;
  const body = { ...base, operators: [dated] };
  assert.equal(validateOperatorBundle({ ...body, integrity: { algorithm: "sha256", sha256: bundleSha256(body) } }).ok, true);
});
test("accepts deterministic additional faction relationships in v1", () => {
  const body = Object.fromEntries(Object.entries(make()).filter(([key]) => key !== "integrity")) as Omit<OperatorBundle, "integrity">;
  const withRelation = { ...body, operators: [{ ...op(), additionalFactionIds: ["faction:a", "faction:b"] }] };
  assert.equal(validateOperatorBundle({ ...withRelation, integrity: { algorithm: "sha256", sha256: bundleSha256(withRelation) } }).ok, true);
});
test("rejects unsorted additional faction relationships", () => {
  const body = Object.fromEntries(Object.entries(make()).filter(([key]) => key !== "integrity")) as Omit<OperatorBundle, "integrity">;
  const withRelation = { ...body, operators: [{ ...op(), additionalFactionIds: ["faction:b", "faction:a"] }] };
  assert.equal(validateOperatorBundle({ ...withRelation, integrity: { algorithm: "sha256", sha256: bundleSha256(withRelation) } }).ok, false);
});
test("rejects a CN date without provenance metadata", () => {
  const base = Object.fromEntries(Object.entries(make()).filter(([key]) => key !== "integrity")) as Omit<OperatorBundle, "integrity">;
  const body = { ...base, operators: [{ ...op(), cnReleaseDate: "2026-01-01" }] };
  assert.equal(validateOperatorBundle({ ...body, integrity: { algorithm: "sha256", sha256: bundleSha256(body) } }).ok, false);
});
for (const [name, mutate] of [
  ["unknown version", (b: OperatorBundle) => ({ ...b, contractVersion: "9" })],
  ["duplicate ID", (b: OperatorBundle) => ({ ...b, operators: [op(), op()] })],
  ["duplicate slug", (b: OperatorBundle) => ({ ...b, operators: [op("char_a"), op("char_b")] })],
  ["invalid region", (b: OperatorBundle) => ({ ...b, biographies: [{ operatorId: "char_test", region: "xx" }] })],
  ["bad hash", (b: OperatorBundle) => ({ ...b, integrity: { algorithm: "sha256", sha256: "0".repeat(64) } })],
  ["missing required field", (b: OperatorBundle) => ({ ...b, operators: [{ ...op(), name: "" }] })],
] as const) test(name, () => assert.equal(validateOperatorBundle(mutate(make()) as unknown).ok, false));
test("rejects an orphan biography", () => assert.equal(validateOperatorBundle({ ...make(), biographies: [{ operatorId: "char_missing" }] }).ok, false));
test("rejects non-deterministic operator order", () => assert.equal(validateOperatorBundle({ ...make(), operators: [op("char_z"), op("char_a")] }).ok, false));
test("generator argument parsing rejects missing values and normalizes source hashes", async () => {
  assert.equal(arg("--out", ["node", "script", "--out", "bundle.json"]), "bundle.json");
  assert.throws(() => arg("--out", ["node", "script"]), /Missing --out/);
  assert.throws(() => arg("--out", ["node", "script", "--out", "--force"]), /Missing --out/);
  assert.deepEqual(generatorSource("repo", "revision", "path", "ABCDEF"), { repository: "repo", revision: "revision", path: "path", sha256: "abcdef" });
  await assert.rejects(generateBundleMain(["node", "generate-operator-bundle.ts"]), /Missing --en-character/);
});
