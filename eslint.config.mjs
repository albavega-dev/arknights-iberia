import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated output.
    "coverage/**",
  ]),
  {
    // The next/image mocks render a plain img on purpose.
    files: ["tests/components/**/*.test.tsx"],
    rules: { "@next/next/no-img-element": "off" },
  },
]);

export default eslintConfig;
