import assert from "node:assert/strict";
import test from "node:test";
import { changedTextFiles } from "../scripts/check-text-encoding";

test("the changed files skip deleted files and the original path of renames", () => {
  const status = [
    " M src/a.ts", "M  docs/b.md", "?? tests/c.test.ts", "A  data/d.json", "AM data/e.json",
    "D  scripts/gone.ts", " D docs/gone.md",
    "R  scripts/new-name.ts", "scripts/old-name.ts",
    "RM docs/moved.md", "docs/before.md",
    "?? public/image.webp", "",
  ].join("\0");
  assert.deepEqual(changedTextFiles(status), ["src/a.ts", "docs/b.md", "tests/c.test.ts", "data/d.json", "data/e.json", "scripts/new-name.ts", "docs/moved.md"]);
  assert.deepEqual(changedTextFiles(""), []);
});
