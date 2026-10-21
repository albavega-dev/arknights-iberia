import assert from "node:assert/strict";
import test from "node:test";
import { buildPlan, buildProposal, classifyRows, parseArguments, planChanges } from "../scripts/sync-cn-release-dates";

test("CN sync is dry-run by default and requires explicit confirmation", () => {
  assert.deepEqual(parseArguments(["node", "script"]), { apply: false });
  assert.throws(() => parseArguments(["node", "script", "--apply"]), /confirm-local-cn-sync/);
  assert.deepEqual(parseArguments(["node", "script", "--apply", "--confirm-local-cn-sync"]), { apply: true });
  assert.deepEqual(parseArguments(["node", "script", "--connected-dry-run"]), { apply: false });
});

test("proposal excludes unknown dates without inventing them", () => {
  const proposal = buildProposal(
    { operators: [{ id: "char_global", cnReleaseDate: "2026-01-01" }] },
    { operators: [{ id: "char_unknown", cnReleaseDate: null }] },
  );
  assert.deepEqual([...proposal.keys()], ["char_global"]);
});

test("CN sync plans only date changes", () => {
  const proposal = buildProposal({ operators: [{ id: "char_a", cnReleaseDate: "2026-01-01" }] }, {});
  assert.deepEqual(planChanges([{ id: "char_a", current: null, proposed: null }], proposal), [
    { id: "char_a", current: null, proposed: "2026-01-01" },
  ]);
});

test("classification distinguishes absent, equivalent, conflict and Clementia", () => {
  const plan = buildPlan(
    { operators: [{ id: "char_a", cnReleaseDate: "2026-01-01" }] },
    { operators: [{ id: "char_4231_clemnt", cnReleaseDate: null }] },
  );
  const result = classifyRows(
    [
      { id: "char_4231_clemnt", current: null, proposed: null },
      { id: "char_a", current: null, proposed: null },
    ],
    plan,
  );
  assert.equal(result.absent.length, 1);
  assert.equal(result.unknown.length, 1);
  assert.equal(result.conflicts.length, 0);
  assert.equal(planChanges(result.absent, plan.knownDates).length, 1);
  const conflict = classifyRows(
    [
      { id: "char_4231_clemnt", current: null, proposed: null },
      { id: "char_a", current: "2026-02-01", proposed: null },
    ],
    plan,
  );
  assert.equal(conflict.conflicts.length, 1);
});

test("classification rejects missing, unexpected and duplicate IDs", () => {
  const plan = buildPlan(
    { operators: [{ id: "char_a", cnReleaseDate: "2026-01-01" }] },
    { operators: [{ id: "char_4231_clemnt", cnReleaseDate: null }] },
  );
  assert.throws(() => classifyRows([{ id: "char_a", current: null, proposed: null }], plan), /target mismatch/);
  assert.throws(
    () =>
      classifyRows(
        [
          { id: "char_a", current: null, proposed: null },
          { id: "char_4231_clemnt", current: null, proposed: null },
          { id: "char_extra", current: null, proposed: null },
        ],
        plan,
      ),
    /target mismatch/,
  );
  assert.throws(
    () =>
      classifyRows(
        [
          { id: "char_a", current: null, proposed: null },
          { id: "char_a", current: null, proposed: null },
        ],
        plan,
      ),
    /target mismatch/,
  );
});
