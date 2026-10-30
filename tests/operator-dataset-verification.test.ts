import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { compareDatasets, reportVerification, type ComparableDataset } from "../scripts/operator-dataset-io";

const dataset = (overrides: Partial<ComparableDataset> = {}): ComparableDataset => ({
  sources: { en: { revision: "a" } },
  tables: { en: { skill_table: { sha256: "1" } } },
  profiles: [{ operatorId: "char_a", region: "en", skills: [1], talents: [] } as never, { operatorId: "char_b", region: "en", skills: [2], talents: [] } as never],
  shared: { "glossary-en": { terms: { a: 1 } } },
  ...overrides,
});

describe("dataset verification", () => {
  it("reports identical datasets and ignores reference operators outside the catalog", () => {
    const reference = dataset({ profiles: [...dataset().profiles, { operatorId: "char_x", region: "en" }] });
    const result = compareDatasets(reference, dataset());
    assert.deepEqual({ identical: result.identical, ignored: result.ignored, failed: result.differences.length + result.missing.length }, { identical: 2, ignored: 1, failed: 0 });
    assert.doesNotThrow(() => reportVerification(result, () => undefined));
  });

  it("lists the keys that change per operator", () => {
    const generated = dataset({ profiles: [{ operatorId: "char_a", region: "en", skills: [9], talents: [], extra: true } as never, dataset().profiles[1]!] });
    const result = compareDatasets(dataset(), generated);
    assert.deepEqual(result.differences, [{ operatorId: "char_a", keys: ["skills", "extra"] }]);
    const lines: string[] = [];
    assert.throws(() => reportVerification(result, (line) => lines.push(line)), /Verification failed/);
    assert.ok(lines.some((line) => line.includes("char_a: skills, extra")));
  });

  it("fails on operators missing from the reference, changed sources, tables and shared files", () => {
    const generated = dataset({
      profiles: [...dataset().profiles, { operatorId: "char_new", region: "cn" }],
      sources: { en: { revision: "b" } },
      tables: undefined,
      shared: { "glossary-en": { terms: { a: 2 } }, "glossary-cn": {} },
    });
    const result = compareDatasets(dataset(), generated);
    assert.deepEqual(result.missing, ["char_new/cn"]);
    assert.deepEqual(result.sources, ["sources", "tables"]);
    assert.deepEqual(result.shared, ["glossary-en", "glossary-cn"]);
    assert.throws(() => reportVerification(result, () => undefined), /Verification failed/);
  });

  it("caps the per-operator listing", () => {
    const many = Array.from({ length: 52 }, (_, i) => ({ operatorId: `char_${i}`, keys: ["skills"] }));
    const lines: string[] = [];
    assert.throws(() => reportVerification({ identical: 0, differences: many, missing: ["m/en"], ignored: 0, sources: [], shared: [] }, (line) => lines.push(line)));
    assert.ok(lines.some((line) => line.includes("and 2 more operators")));
    assert.ok(lines.some((line) => line.includes("missing from the reference: m/en")));
  });
});
