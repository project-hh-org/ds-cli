import { createRequire } from "node:module";
import type { ESLint, Linter } from "eslint";
import { noDeprecatedComponent } from "./rules/no-deprecated-component.js";
import { noHardcodedStyle } from "./rules/no-hardcoded-style.js";
import { preferDsComponent } from "./rules/prefer-ds-component.js";
import { guardSnapshotHash } from "./snapshot-hash.js";

const pkg = createRequire(import.meta.url)("../package.json") as { version: string };

const rules = {
  "no-hardcoded-style": noHardcodedStyle,
  "prefer-ds-component": preferDsComponent,
  "no-deprecated-component": noDeprecatedComponent,
};

const plugin = {
  meta: { name: "@dsmith-dev/eslint-plugin" as const, version: pkg.version },
  rules,
  configs: {
    /**
     * 접근할 때마다 만든다(getter). `settings.dsmith.snapshotHash`에 `process.cwd()`에서 위로 찾은
     * `.dsmith/guard.json` 내용의 sha256(없으면 "none")을 넣어, guard.json이 바뀌면 `eslint --cache`의 설정 해시가 달라지게 한다.
     * eslint.config.js가 평가될 때(= ESLint 프로세스 시작 시) 한 번 읽는다. 토큰 파일 변경은 반영하지 않는다(guard.json의 해시 목록이 낡음 판정을 맡는다).
     */
    get recommended(): Linter.Config {
      return {
        name: "dsmith/recommended",
        // files가 없으면 ESLint가 .tsx에 "No matching configuration"으로 답한다(부록 C.1). parser는 정하지 않는다 — TS 파싱은 사용자 설정의 몫.
        files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
        plugins: { dsmith: plugin },
        settings: { dsmith: { snapshotHash: guardSnapshotHash() } },
        rules: {
          "dsmith/no-hardcoded-style": "warn",
          "dsmith/prefer-ds-component": "warn",
          "dsmith/no-deprecated-component": "error",
        },
      };
    },
  },
} satisfies ESLint.Plugin & { configs: { recommended: Linter.Config } };

export { guardSnapshotHash };
export default plugin;
