import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import sonarjs from "eslint-plugin-sonarjs";

// Existing files above the complexity limits. A file leaves the list when it is substantially changed.
const cognitiveComplexityExempt = [
  "scripts/check-gamedata-updates.ts",
  "scripts/download-gamedata-snapshot.ts",
  "scripts/dry-run-operator-names.ts",
  "scripts/extract-subpower-candidates.mjs",
  "scripts/extract-terra-artist-credits.ts",
  "scripts/generate-operator-og-images.ts",
  "scripts/generate-operator-skills.ts",
  "scripts/generate-operator-stats.ts",
  "scripts/operator-dataset-io.ts",
  "scripts/regenerate-datasets.ts",
  "scripts/reverify-curated-provenance.ts",
  "scripts/verify-associated-ranges.mjs",
  "scripts/verify-operator-module-ranges.ts",
  "src/app/operators/\\[slug\\]/operator-detail-data.tsx",
  "src/app/operators/operator-catalog.tsx",
  "src/app/operators/range-grid.tsx",
  "src/game-data/gamedata-diff.ts",
  "src/game-data/new-operator-proposal.ts",
  "src/game-data/operator-biography-import.ts",
  "src/game-data/operator-biography.ts",
  "src/game-data/operator-bundle.ts",
  "src/game-data/operator-catalog-verification.ts",
  "src/game-data/operator-catalog.ts",
  "src/game-data/operator-dataset.ts",
  "src/game-data/operator-global-updates.ts",
  "src/game-data/operator-modules.ts",
  "src/game-data/operator-skills.ts",
  "src/game-data/operator-stats.ts",
  "src/game-data/operators.ts",
  "src/game-data/skill-description.ts",
  "src/game-data/wikitext.ts",
  "src/server/db/admin-runtime.ts",
  "src/server/db/config.ts",
  "src/server/db/operator-biography-repository.ts",
  "tests/operator-modules-dataset-integrity.test.ts",
  "tests/operator-skills-dataset-integrity.test.ts",
];

const nestedConditionalExempt = [
  "scripts/check-text-encoding.ts",
  "scripts/download-gamedata-snapshot.ts",
  "scripts/dry-run-operator-names.ts",
  "scripts/extract-subpower-candidates.mjs",
  "scripts/extract-terra-artist-credits.ts",
  "scripts/generate-operator-tactical-manifest.ts",
  "scripts/propose-new-operators.ts",
  "scripts/regenerate-datasets.ts",
  "scripts/reverify-curated-provenance.ts",
  "scripts/verify-operator-catalog-db.ts",
  "scripts/verify-operator-module-ranges.ts",
  "scripts/verify-operator-regional-sets.ts",
  "src/app/operators/\\[slug\\]/operator-detail-data.tsx",
  "src/app/operators/\\[slug\\]/operator-skills-panel.tsx",
  "src/app/operators/\\[slug\\]/operator-tactical-info.tsx",
  "src/app/operators/operator-catalog.tsx",
  "src/app/operators/range-grid.tsx",
  "src/app/site-shell.tsx",
  "src/game-data/gamedata-diff.ts",
  "src/game-data/operator-avatars.ts",
  "src/game-data/operator-catalog-verification.ts",
  "src/game-data/operator-images.ts",
  "src/game-data/operator-limited.ts",
  "src/game-data/operator-modules-view.ts",
  "src/game-data/operator-modules.ts",
  "src/game-data/operator-og-images.ts",
  "src/game-data/operator-skills.ts",
  "src/game-data/operator-slugs.ts",
  "src/game-data/operator-stats.ts",
  "src/game-data/operators.ts",
  "src/game-data/skill-description.ts",
  "tests/operator-factions.test.ts",
  "tests/operator-modules-dataset-integrity.test.ts",
  "tests/operator-modules-view.test.ts",
  "tests/operator-skills-dataset-integrity.test.ts",
  "tests/operator-skills-view.test.ts",
  "tests/operator-stats-dataset-integrity.test.ts",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  sonarjs.configs.recommended,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated output.
    "coverage/**",
    "artifacts/**",
    "test-results/**",
    "playwright-report/**",
    ".playwright-mcp/**",
    ".vercel/**",
  ]),
  {
    // sort() without a comparator compares items as strings; require an explicit one.
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      "@typescript-eslint/require-array-sort-compare": ["error", { ignoreStringArrays: false }],
      // Destructuring drops a property without marking it used.
      "@typescript-eslint/no-unused-vars": ["warn", { ignoreRestSiblings: true }],
    },
  },
  {
    rules: {
      // Flags statements that share a line with a single-line if, which the compact scripts use on purpose.
      "sonarjs/no-unenclosed-multiline-block": "off",
      // Uses the declared types, but these checks guard parsed JSON and regex groups that can be undefined at runtime.
      "sonarjs/different-types-comparison": "off",
      // The skipped tests are conditional and state their reason.
      "sonarjs/no-skipped-tests": "off",
    },
  },
  {
    // Git blob ids are SHA-1 and the portrait CDN verifies files with Content-MD5; neither is used for security.
    files: ["src/game-data/git-blob.ts", "scripts/sync-operator-portraits.ts"],
    rules: { "sonarjs/hashing": "off" },
  },
  {
    // Local development mail server without TLS.
    files: ["src/server/auth/local-email.ts"],
    rules: { "sonarjs/no-clear-text-protocols": "off" },
  },
  {
    // Fixtures: rejected URLs, container addresses, exact expected values and mutable fake classes.
    files: ["tests/**"],
    rules: {
      "sonarjs/no-clear-text-protocols": "off",
      "sonarjs/no-hardcoded-ip": "off",
      "sonarjs/no-floating-point-equality": "off",
      "sonarjs/public-static-readonly": "off",
    },
  },
  {
    files: cognitiveComplexityExempt,
    rules: { "sonarjs/cognitive-complexity": "off" },
  },
  {
    files: nestedConditionalExempt,
    rules: { "sonarjs/no-nested-conditional": "off" },
  },
  {
    // The next/image mocks render a plain img on purpose.
    files: ["tests/components/**/*.test.tsx"],
    rules: { "@next/next/no-img-element": "off" },
  },
]);

export default eslintConfig;
