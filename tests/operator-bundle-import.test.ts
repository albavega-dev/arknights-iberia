import assert from "node:assert/strict";
import test from "node:test";
import { assertLocalImportTarget, assertRegionalMetadataCompatible, importBundle, prepareBundleImport, type ImportAdapter, type ImportCounts } from "../src/server/db/operator-bundle-import";
import { bundleSha256, type OperatorBundle } from "../src/game-data/operator-bundle";

const source = { repository: "example/repo", revision: "a".repeat(40), path: "source.json", sha256: "b".repeat(64) };
const op = { id: "char_test", name: "Test", cnName: null, globalName: null, class: "Guard" as const, subClassId: "swordmaster", rarity: 6 as const, slug: "operator-test", cnOnly: false, availabilityStatus: "global-snapshot" as const, cnReleaseDate: null, globalReleaseDate: null, mainPowerNationId: null, mainPowerGroupId: null, mainPowerTeamId: null, mainFactionId: null };
const makeBundle = (): OperatorBundle => { const body = { contractVersion: "1" as const, sources: { en: source, cn: source }, biographySources: { en: source, cn: source }, operators: [op], biographies: [], coverage: { operators: 1, biographies: { en: 0, cn: 0, total: 0 } } }; return { ...body, integrity: { algorithm: "sha256" as const, sha256: bundleSha256(body) } }; };
const counts: ImportCounts = { inserted: 1, updated: 0, unchanged: 0, skipped: 0 };
function adapter(log: string[], fail = false): ImportAdapter { return { begin: async () => ({ upsertOperators: async () => { log.push("operators"); return counts; }, upsertBiographies: async () => { if (fail) throw new Error("transaction failure"); log.push("biographies"); return { inserted: 0, updated: 0, unchanged: 0, skipped: 0 }; }, commit: async () => { log.push("commit"); }, rollback: async () => { log.push("rollback"); } }) }; }

test("dry-run prepares a plan without opening an adapter", () => assert.deepEqual(prepareBundleImport(makeBundle()).plan, { operators: 1, biographies: 0, counts: { inserted: 0, updated: 0, unchanged: 0, skipped: 0 } }));
test("remote and ambiguous targets are rejected", () => { assert.throws(() => assertLocalImportTarget({ host: "db.example", port: 5432, database: "db", user: "app", password: "x" })); assert.throws(() => assertLocalImportTarget({ host: "localhost", port: 5432, database: "db", user: "app" })); });
test("writes require explicit confirmation", async () => await assert.rejects(importBundle(makeBundle(), adapter([]), false), /explicit confirmation/));
test("commits once and reports counts", async () => { const log: string[] = []; const result = await importBundle(makeBundle(), adapter(log), true); assert.deepEqual(log, ["operators", "biographies", "commit"]); assert.equal(result.counts.inserted, 1); });
test("rolls back on transaction failure", async () => { const log: string[] = []; await assert.rejects(importBundle(makeBundle(), adapter(log, true), true)); assert.deepEqual(log, ["operators", "rollback"]); });
test("does not expose a delete operation", () => { const log: string[] = []; assert.ok(adapter(log).begin); });
test("accepts empty and equivalent regional metadata", () => { assert.doesNotThrow(() => assertRegionalMetadataCompatible(null, "incoming")); assert.doesNotThrow(() => assertRegionalMetadataCompatible("", "incoming")); assert.doesNotThrow(() => assertRegionalMetadataCompatible("incoming", "incoming")); });
test("rejects different or unrecognized regional metadata", () => { assert.throws(() => assertRegionalMetadataCompatible("old-regional-metadata", "incoming"), /conflicts/); assert.throws(() => assertRegionalMetadataCompatible("not-json", "incoming"), /conflicts/); });
