import assert from "node:assert/strict";
import test from "node:test";

import { getOperatorArchetypeName, knownOperatorArchetypeIds } from "../src/game-data/operator-archetypes";

test("resolves verified public English archetype labels", () => {
  assert.equal(getOperatorArchetypeName("artsfghter"), "Arts Fighter");
  assert.equal(getOperatorArchetypeName("splashcaster"), "Splash Caster");
  assert.equal(getOperatorArchetypeName("bearer"), "Standard Bearer");
  assert.equal(getOperatorArchetypeName("aoesniper"), "Artilleryman");
  assert.equal(getOperatorArchetypeName("closerange"), "Heavyshooter");
  assert.equal(getOperatorArchetypeName("fastshot"), "Marksman");
  assert.equal(getOperatorArchetypeName("funnel"), "Mech-Accord Caster");
  assert.equal(getOperatorArchetypeName("reaperrange"), "Spreadshooter");
  assert.equal(getOperatorArchetypeName("ringhealer"), "Multi-target Medic");
  assert.equal(getOperatorArchetypeName("unyield"), "Juggernaut");
  assert.equal(getOperatorArchetypeName("supportiveranger"), "Supportive Ranger");
});

test("keeps unknown or unresolved identifiers visible without inventing a label", () => {
  assert.equal(getOperatorArchetypeName("notchar1"), "notchar1");
  assert.equal(getOperatorArchetypeName("future-subclass"), "future-subclass");
});

test("catalogues every subclass identifier observed in the fixed snapshot", () => {
  assert.equal(knownOperatorArchetypeIds.length, 73);
  assert.ok(knownOperatorArchetypeIds.includes("artsfghter"));
  assert.ok(knownOperatorArchetypeIds.includes("splashcaster"));
  assert.deepEqual(knownOperatorArchetypeIds.filter((id) => !["notchar1", "notchar2"].includes(id)).filter((id) => getOperatorArchetypeName(id) === id), []);
});
