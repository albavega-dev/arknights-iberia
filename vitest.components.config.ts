import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/components/setup.ts"],
    include: ["tests/components/**/*.test.tsx", "tests/operator-stats.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "coverage/components",
      include: [
        "src/app/operators/[slug]/operator-detail-data.tsx",
        "src/app/operators/[slug]/operator-tactical-info.tsx",
        "src/app/operators/[slug]/operator-skills-panel.tsx",
        "src/app/operators/[slug]/operator-modules-panel.tsx",
        "src/app/operators/pointer-light.ts",
        "src/app/operators/range-grid.tsx",
        "src/game-data/operator-stats.ts",
      ],
      exclude: ["**/*.d.ts"],
    },
  },
});
