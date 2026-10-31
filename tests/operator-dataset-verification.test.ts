import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { applyRevisionChanges, changedFields, compareDatasets, reportVerification, revisionChanges, verificationMode, verifyUpdate, type ComparableDataset } from "../scripts/operator-dataset-io";

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
    assert.deepEqual(result.differences, [{ operatorId: "char_a", keys: ["skills", "extra"], fields: ["skills[0]", "extra"] }]);
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
    const many = Array.from({ length: 52 }, (_, i) => ({ operatorId: `char_${i}`, keys: ["skills"], fields: ["skills"] }));
    const lines: string[] = [];
    assert.throws(() => reportVerification({ identical: 0, differences: many, missing: ["m/en"], ignored: 0, removed: [], sources: [], shared: [] }, (line) => lines.push(line)));
    assert.ok(lines.some((line) => line.includes("and 2 more operators")));
    assert.ok(lines.some((line) => line.includes("missing from the reference: m/en")));
  });
});

describe("changed fields", () => {
  it("returns the paths of the leaves that differ", () => {
    assert.deepEqual(changedFields({ a: { b: [1, { c: 2 }] }, d: 1 }, { a: { b: [1, { c: 3 }] }, d: 1, e: 0 }), ["a.b[1].c", "e"]);
    assert.deepEqual(changedFields({ list: [1, 2] }, { list: [1] }), ["list"], "arrays of another length are reported whole");
    assert.deepEqual(changedFields(1, 2), ["(root)"]);
    assert.deepEqual(changedFields({ a: 1 }, { a: 1 }), []);
  });
});

describe("revision changes", () => {
  it("pairs revisions and hashes of sources and tables and skips ambiguous ones", () => {
    const changes = revisionChanges(
      { en: { revision: "a", sha256: "h1", path: "p" }, cn: { revision: "a", sha256: "h2" } },
      { en: { revision: "b", sha256: "h3", path: "q" }, cn: { revision: "c", sha256: "h2" } },
    );
    assert.deepEqual([...changes], [["a", null], ["h1", "h3"]], "paths are not revisions and a revision with two targets is left out");
    assert.deepEqual(applyRevisionChanges({ list: ["h1", "a", 3] }, changes), { list: ["h3", "a", 3] });
  });

  it("changes a full commit inside a source URL, unless it is ambiguous", () => {
    const [from, to, other] = ["1", "2", "3"].map((digit) => digit.repeat(40)) as [string, string, string];
    const url = (commit: string) => `https://github.com/Owner/Data/blob/${commit}/cn/gamedata/excel/gacha_table.json#NORM_0_1_1`;
    assert.equal(applyRevisionChanges(url(from), new Map([[from, to]])), url(to));
    assert.equal(applyRevisionChanges(url(from), new Map([[from, null]])), url(from));
    assert.equal(applyRevisionChanges(url(other), new Map([[from, to]])), url(other));
  });

  it("expects the revision inside profiles and shared files only with revisionChange", () => {
    const reference = dataset({ profiles: [{ operatorId: "char_a", region: "en", source: { revision: "a" }, skills: [1] } as never], shared: { "glossary-en": { revision: "a" } } });
    const generated = dataset({ sources: { en: { revision: "b" } }, profiles: [{ operatorId: "char_a", region: "en", source: { revision: "b" }, skills: [1] } as never], shared: { "glossary-en": { revision: "b" } } });
    const strict = compareDatasets(reference, generated);
    assert.deepEqual([strict.differences.map((item) => item.fields), strict.shared], [[["source.revision"]], ["glossary-en"]]);
    const update = compareDatasets(reference, generated, { revisionChange: true });
    assert.deepEqual([update.identical, update.differences, update.shared, update.sources], [1, [], [], ["sources"]]);
  });
});

describe("verification mode", () => {
  it("is strict by default and update with --update", () => {
    assert.equal(verificationMode(["--out-dir", "x"]), undefined);
    assert.equal(verificationMode(["--verify-against", "r"]), "strict");
    assert.equal(verificationMode(["--verify-against", "r", "--update", "--report", "f"]), "update");
  });

  it("rejects the update options without --verify-against or --update", () => {
    assert.throws(() => verificationMode(["--update"]), /need --verify-against/);
    assert.throws(() => verificationMode(["--approve", "f"]), /need --verify-against/);
    assert.throws(() => verificationMode(["--verify-against", "r", "--report", "f"]), /need --update/);
  });
});

describe("update verification", () => {
  const changed = () => {
    const generated = dataset({
      sources: { en: { revision: "b" } },
      profiles: [{ operatorId: "char_a", region: "en", skills: [9], talents: [] } as never, { operatorId: "char_new", region: "cn" }],
      shared: { "glossary-en": { terms: { a: 1 } } },
    });
    return compareDatasets(dataset(), generated, { revisionChange: true });
  };
  const sections = () => [{ label: "operator-skills", verification: changed(), sources: { en: { revision: "b" } } }];

  it("accepts a revision change alone without approval", async () => {
    const verification = compareDatasets(dataset(), dataset({ sources: { en: { revision: "b" } } }), { revisionChange: true });
    const lines: string[] = [];
    await verifyUpdate([{ label: "operator-skills", verification, sources: {} }], [], (line) => lines.push(line));
    assert.ok(lines.includes("  expected revision change in: sources"));
  });

  it("lists the changes per operator and field and refuses to continue without approval", async () => {
    const lines: string[] = [];
    await assert.rejects(verifyUpdate(sections(), [], (line) => lines.push(line)), /Changes pending approval; output not written/);
    assert.ok(lines.includes("operator-skills (update): 0 identical, 1 different, 1 added, 1 removed"));
    assert.ok(lines.includes("  char_a: skills[0]"));
    assert.ok(lines.includes("  added (missing from the reference): char_new/cn"));
    assert.ok(lines.includes("  removed (only in the reference): char_b/en"));
  });

  it("caps the fields shown per operator", async () => {
    const fields = Array.from({ length: 12 }, (_, i) => `f${i}`);
    const verification = { identical: 0, differences: [{ operatorId: "char_a", keys: ["f"], fields }], missing: [], ignored: 0, removed: [], sources: [], shared: ["glossary-en"] };
    const lines: string[] = [];
    await assert.rejects(verifyUpdate([{ label: "x", verification, sources: {} }], [], (line) => lines.push(line)));
    assert.ok(lines.some((line) => line.endsWith("f9 and 2 more fields")));
    assert.ok(lines.includes("  shared files that change: glossary-en"));
    assert.ok(lines.includes("  no revision change"));
  });

  it("writes the report and continues only with an approval that matches it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dataset-update-"));
    const report = join(directory, "report.json");
    try {
      await assert.rejects(verifyUpdate(sections(), ["--report", report], () => undefined), /pending approval/);
      const saved = JSON.parse(await readFile(report, "utf8"));
      assert.deepEqual(saved.update["operator-skills"].operators, [{ operatorId: "char_a", fields: ["skills[0]"] }]);
      await verifyUpdate(sections(), ["--approve", report, "--report", report], () => undefined);
      assert.deepEqual(JSON.parse(await readFile(report, "utf8")), saved, "the approval is read before the report is rewritten");
      const other = join(directory, "other.json");
      await writeFile(other, JSON.stringify({ ...saved, update: { "operator-skills": { ...saved.update["operator-skills"], added: [] } } }), "utf8");
      await assert.rejects(verifyUpdate(sections(), ["--approve", other], () => undefined), /differ from the approved report; output not written/);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
