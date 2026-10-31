import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import catalog from "../data/operator-catalog/index.json";
import manifest from "../data/operator-limited-manifest.json";
import { gameDataRevisions } from "../src/game-data/gamedata-revisions";
import { limitedManifestErrors, limitedOperatorsFrom, type LimitedManifest } from "../src/game-data/operator-limited";
import { main } from "../scripts/generate-operator-limited-manifest";
import { sha256 } from "../scripts/operator-dataset-io";

const gacha = {
  gachaPoolClient: [
    { gachaPoolId: "NORM_1", gachaRuleType: "NORMAL", limitParam: null },
    { gachaPoolId: "LIMITED_2", gachaRuleType: "LIMITED", limitParam: { limitedCharId: "char_2_b" } },
    { gachaPoolId: "LINKAGE_1", gachaRuleType: "LINKAGE", linkageParam: { guaranteeTarget6Char: "char_9_x" } },
    { gachaPoolId: "LIMITED_1", gachaRuleType: "LIMITED", limitParam: { limitedCharId: "char_1_a" } },
    { gachaPoolId: "LIMITED_3", gachaRuleType: "LIMITED", limitParam: { limitedCharId: "char_1_a" } },
  ],
};

test("limited operators come only from LIMITED banners, once each, ordered by id", () => {
  assert.deepEqual(limitedOperatorsFrom(gacha), [{ id: "char_1_a", pool: "LIMITED_1" }, { id: "char_2_b", pool: "LIMITED_2" }]);
  assert.throws(() => limitedOperatorsFrom({}), /no gachaPoolClient/);
  assert.throws(() => limitedOperatorsFrom({ gachaPoolClient: [{ gachaPoolId: "LIMITED_4", gachaRuleType: "LIMITED", limitParam: {} }] }), /without limitedCharId/);
});

test("the versioned limited manifest is current, ordered and only lists catalog operators", () => {
  const ids = new Set(catalog.operators.map((operator) => operator.id));
  assert.deepEqual(limitedManifestErrors(manifest as LimitedManifest, ids), []);
  assert.equal(manifest.source.revision, gameDataRevisions.cn);
  const bad: LimitedManifest = { ...(manifest as LimitedManifest), operators: [{ id: "char_2_b", pool: "x" }, { id: "char_1_a", pool: "y" }, { id: "char_1_a", pool: "z" }] };
  assert.deepEqual(limitedManifestErrors(bad, new Set(["char_1_a"])), ["duplicate operator ids", "operators are not ordered by id", "char_2_b is not a catalog operator"]);
});

test("the generator checks the pinned hash and keeps only the catalog operators", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "operator-limited-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = (name: string) => path.join(root, name);
  const bytes = JSON.stringify(gacha);
  await writeFile(file("gacha.json"), bytes);
  await writeFile(file("catalog.json"), JSON.stringify({ operators: [{ id: "char_1_a" }] }));
  const argv = ["node", "generate", "--cn-gacha", file("gacha.json"), "--catalog", file("catalog.json"), "--out", file("out.json")];
  await assert.rejects(main(argv, { expectedHash: "0".repeat(64) }), /does not match the pinned SHA-256/);
  await main(argv, { expectedHash: sha256(bytes) });
  const written = JSON.parse(await readFile(file("out.json"), "utf8")) as LimitedManifest;
  assert.deepEqual(written.operators, [{ id: "char_1_a", pool: "LIMITED_1" }]);
  assert.equal(written.source.revision, gameDataRevisions.cn);
  await main([...argv.slice(0, -1), file("nested/out.json")], { expectedHash: sha256(bytes), revision: "a".repeat(40) });
  assert.equal((JSON.parse(await readFile(file("nested/out.json"), "utf8")) as LimitedManifest).source.revision, "a".repeat(40), "a snapshot revision not pinned yet");
});
