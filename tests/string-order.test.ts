import assert from "node:assert/strict";
import test from "node:test";
import { compareCodeUnits } from "../src/game-data/string-order";

test("orders strings by code unit, as a plain sort does", () => {
  const values = ["b", "B", "a", "ñ", "é", "e", "Z", "a b", "a", "10", "9"];
  assert.deepEqual([...values].sort(compareCodeUnits), [...values].sort());
  assert.equal(compareCodeUnits("a", "a"), 0);
  assert.equal(compareCodeUnits("B", "a"), -1);
  assert.equal(compareCodeUnits("b", "B"), 1);
});
