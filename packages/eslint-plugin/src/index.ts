import { createRequire } from "node:module";
import type { ESLint, Linter } from "eslint";
import { noDeprecatedComponent } from "./rules/no-deprecated-component.js";
import { noHardcodedStyle } from "./rules/no-hardcoded-style.js";
import { preferDsComponent } from "./rules/prefer-ds-component.js";

const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

const rules = {
  "no-hardcoded-style": noHardcodedStyle,
  "prefer-ds-component": preferDsComponent,
  "no-deprecated-component": noDeprecatedComponent,
};

const plugin = {
  meta: { name: "@dsmith-dev/eslint-plugin" as const, version: pkg.version },
  rules,
  configs: {} as { recommended: Linter.Config },
} satisfies ESLint.Plugin & { configs: { recommended: Linter.Config } };

// files가 없으면 ESLint가 .tsx에 "No matching configuration"으로 답한다(부록 C.1). parser는 정하지 않는다 — TS 파싱은 사용자 설정의 몫.
plugin.configs.recommended = {
  name: "dsmith/recommended",
  files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
  plugins: { dsmith: plugin },
  rules: {
    "dsmith/no-hardcoded-style": "warn",
    "dsmith/prefer-ds-component": "warn",
    "dsmith/no-deprecated-component": "error",
  },
};

export default plugin;
