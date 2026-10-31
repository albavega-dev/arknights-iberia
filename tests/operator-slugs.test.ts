import assert from "node:assert/strict";
import test from "node:test";

import type { OperatorRecord } from "../src/game-data/operators";
import { readFile } from "node:fs/promises";
import { catalogOperatorRecord, type OperatorCatalog } from "../src/game-data/operator-catalog";
import { getOperatorPageTitle, getOperatorPublicSlugs, normalizeOperatorSlugPart, resolveOperatorSlug } from "../src/game-data/operator-slugs";

const operator = (id: string, name: string): OperatorRecord => ({ id, name, class: "Guard", subClassId: null, rarity: 5, slug: `operator-${id}`, cnOnly: false, availabilityStatus: "global-snapshot", cnReleaseDate: null, globalReleaseDate: null, mainPowerNationId: null, mainPowerGroupId: null, mainPowerTeamId: null, mainFactionId: null });

test("normalizes names without accents or punctuation", () => {
  assert.equal(normalizeOperatorSlugPart("Ch'en the Dawnstreak"), "ch-en-the-dawnstreak");
  assert.equal(normalizeOperatorSlugPart("Élan / María"), "elan-maria");
});

test("uses names normally and adds deterministic suffixes only for collisions", () => {
  const records = [operator("char_1", "Ripresa"), operator("char_2", "Amiya"), operator("char_3", "Amiya")];
  const slugs = getOperatorPublicSlugs(records);
  assert.equal(slugs.get("char_1"), "ripresa");
  assert.equal(slugs.get("char_2"), "amiya-char-2");
  assert.equal(slugs.get("char_3"), "amiya-2-char-3");
  assert.equal(new Set(slugs.values()).size, records.length);
});

test("uses the Spanish operator prefix without translating the public name", () => {
  assert.equal(getOperatorPageTitle({ name: "Ripresa", globalName: null }), "Operador - Ripresa");
  assert.equal(getOperatorPageTitle({ name: "Nombre local", globalName: "Kal'tsit" }), "Operador - Kal'tsit");
});

test("normalizing keeps its results for edge cases and takes linear time on hostile input", () => {
  assert.equal(normalizeOperatorSlugPart("--A  b--"), "a-b");
  assert.equal(normalizeOperatorSlugPart("!!!"), "operator");
  const started = performance.now();
  for (const hostile of ["a" + "-".repeat(200_000) + "!b", "-".repeat(200_000) + "!", "!".repeat(200_000) + "a"]) normalizeOperatorSlugPart(hostile);
  assert.ok(performance.now() - started < 1000, "hostile inputs finish well under a second");
});

test("a slug resolves to its operator, and only the current public slug needs no redirect", () => {
  const records = [operator("char_1", "Ripresa"), operator("char_2", "Aegis")];
  const previous = new Map([["aigis", "char_2"]]);
  assert.deepEqual(resolveOperatorSlug("aegis", records, previous), { operator: records[1], publicSlug: "aegis", redirect: false });
  assert.deepEqual(resolveOperatorSlug("aigis", records, previous), { operator: records[1], publicSlug: "aegis", redirect: true });
  assert.deepEqual(resolveOperatorSlug("operator-char_2", records, previous), { operator: records[1], publicSlug: "aegis", redirect: true });
  assert.equal(resolveOperatorSlug("nobody", records, previous), null);
  assert.equal(resolveOperatorSlug("gone", records, new Map([["gone", "char_missing"]])), null);
});
