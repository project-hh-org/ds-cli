import fs from "node:fs";
import { describe, it } from "vitest";
import { RuleTester } from "eslint";
import { createHash } from "node:crypto";
import plugin from "../src/index.js";
import { makeRoot, snapshotOf } from "./helpers.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({ languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } });

const plain = makeRoot("plain", snapshotOf());
const linked = makeRoot(
  "linked",
  snapshotOf({
    preset: { version: 3, file: "design-system/tailwind.preset.ts", linked: true, keys: { "--color-blue-500": "ds-blue-500", "--space-2": "ds-2", "--space-4": "ds-4" } },
  }),
);
const unlinked = makeRoot(
  "unlinked",
  snapshotOf({
    preset: { version: 3, file: "design-system/tailwind.preset.ts", linked: false, keys: { "--color-blue-500": "ds-blue-500" } },
  }),
);
const allowed = makeRoot(
  "allowed",
  snapshotOf({
    policy: { allow: { files: ["src/legacy/**"], properties: ["border-radius"] }, minConfidence: "close", failOn: { newHardcoded: 0, deprecated: 0 } },
  }),
);
const exact = makeRoot(
  "exact-only",
  snapshotOf({ policy: { allow: { files: [], properties: [] }, minConfidence: "exact", failOn: { newHardcoded: 0, deprecated: 0 } } }),
);
const bare = makeRoot("bare", null);
const stale = makeRoot("stale", null);
fs.writeFileSync(stale.abs("tokens.css"), ":root{--color-blue-500:#3b82f6}");
const staleSnap = snapshotOf({ tokenFiles: [{ file: "tokens.css", sha256: createHash("sha256").update(":root{--color-blue-500:#000}").digest("hex") }] });
fs.mkdirSync(stale.abs(".dsmith"), { recursive: true });
fs.writeFileSync(stale.guardFile, JSON.stringify(staleSnap));

const withDs = makeRoot(
  "components",
  snapshotOf({
    ds: {
      modules: ["components/ui"],
      components: [
        { name: "Button", module: "components/ui/button" },
        { name: "Dialog", module: "components/ui/dialog", deprecated: "Use Modal\n더 이상 쓰지 않음" },
        { name: "Card", module: "components/ui/card", status: "scaffold" },
      ],
    },
    preferred: [{ name: "Modal", module: "components/ui/modal" }],
  }),
);

const at = (r: { abs: (f: string) => string; guardFile: string }, file: string) => ({ filename: r.abs(file), settings: { dsmith: { guardFile: r.guardFile } } });

describe("no-hardcoded-style", () => {
  tester.run("no-hardcoded-style", plugin.rules["no-hardcoded-style"], {
    valid: [
      // 토큰 사용·기본 팔레트
      { code: `const A = () => <div style={{ color: "var(--color-blue-500)" }} />;`, ...at(plain, "src/a.jsx") },
      { code: `const A = () => <div className="bg-blue-500" />;`, ...at(plain, "src/b.jsx") },
      // allow.files / allow.properties
      { code: `const A = () => <div style={{ color: "#3b82f6" }} />;`, ...at(allowed, "src/legacy/a.jsx") },
      { code: `const A = () => <div style={{ borderRadius: 8 }} />;`, ...at(allowed, "src/c.jsx") },
      // 스냅샷 없음 → 조용
      { code: `const A = () => <div style={{ color: "#3b82f6" }} />;`, filename: bare.abs("src/a.jsx") },
      // 토큰 치환 대상이 아닌 속성(width)은 기본으로 보고하지 않는다
      { code: `const A = () => <div style={{ width: 100 }} />;`, ...at(plain, "src/d.jsx") },
      // snapshot.exclude
      { code: `const A = () => <div style={{ color: "#3b82f6" }} />;`, ...at(plain, "node_modules/x/a.jsx") },
      // root 밖 파일
      { code: `const A = () => <div style={{ color: "#3b82f6" }} />;`, filename: "/definitely/outside/a.jsx", settings: { dsmith: { guardFile: plain.guardFile } } },
    ],
    invalid: [
      {
        code: `const A = () => <div className="bg-[#3b82f6]" />;`,
        ...at(plain, "src/tw1.jsx"),
        output: `const A = () => <div className="bg-[color:var(--color-blue-500)]" />;`,
        errors: [{ messageId: "finding", line: 1, column: 33 }],
      },
      {
        code: `const A = () => <div className="p-2 md:bg-[#3b82f6]" />;`,
        ...at(linked, "src/tw2.jsx"),
        output: `const A = () => <div className="p-2 md:bg-ds-blue-500" />;`,
        errors: [{ messageId: "finding" }],
      },
      {
        // 프리셋이 연결 안 됐으면 임의값 폴백
        code: `const A = () => <div className="bg-[#3b82f6]" />;`,
        ...at(unlinked, "src/tw3.jsx"),
        output: `const A = () => <div className="bg-[color:var(--color-blue-500)]" />;`,
        errors: [{ messageId: "finding" }],
      },
      {
        // 거리 < 0.005는 exact로 판정된다 → fix
        code: `const A = () => <div className="bg-[#3c83f7]" />;`,
        ...at(plain, "src/tw-near.jsx"),
        output: `const A = () => <div className="bg-[color:var(--color-blue-500)]" />;`,
        errors: [{ messageId: "finding" }],
      },
      {
        // close → fix 없음, suggestion 1
        code: `const A = () => <div className="bg-[#4286f5]" />;`,
        ...at(plain, "src/tw4.jsx"),
        output: null,
        errors: [
          {
            messageId: "finding",
            suggestions: [{ messageId: "replace", data: { token: "--color-blue-500" }, output: `const A = () => <div className="bg-[color:var(--color-blue-500)]" />;` }],
          },
        ],
      },
      {
        // 먼 색 → 메시지만
        code: `const A = () => <div style={{ color: "#ff00aa" }} />;`,
        ...at(plain, "src/far.jsx"),
        output: null,
        errors: [{ message: /가까운 토큰 없음/, suggestions: [] }],
      },
      {
        code: `const A = () => <div style={{ padding: 8 }} />;`,
        ...at(plain, "src/inline1.jsx"),
        output: `const A = () => <div style={{ padding: "var(--space-2)" }} />;`,
        errors: [{ messageId: "finding", line: 1, column: 40 }],
      },
      {
        code: `const A = () => <div style={{ color: "#3b82f6" }} />;`,
        ...at(plain, "src/inline2.jsx"),
        output: `const A = () => <div style={{ color: "var(--color-blue-500)" }} />;`,
        errors: [{ message: /하드코딩 color #3b82f6/ }],
      },
      {
        code: "import styled from \"styled-components\";\nconst Box = styled.div`\n  color: #3b82f6;\n`;",
        ...at(plain, "src/styled1.jsx"),
        output: "import styled from \"styled-components\";\nconst Box = styled.div`\n  color: var(--color-blue-500);\n`;",
        errors: [{ messageId: "finding", line: 3 }],
      },
      {
        code: `const A = () => <Box sx={{ p: "16px" }} />;`,
        ...at(plain, "src/sx1.jsx"),
        output: `const A = () => <Box sx={{ p: 2 }} />;`,
        errors: [{ messageId: "finding" }],
      },
      {
        // minConfidence exact → close 값은 치환 제안 자체가 없다
        code: `const A = () => <div className="bg-[#4286f5]" />;`,
        ...at(exact, "src/exact.jsx"),
        output: null,
        errors: [{ message: /가까운 토큰 없음/, suggestions: [] }],
      },
      {
        // 낡은 스냅샷(토큰 파일 해시 불일치)이면 exact여도 --fix는 하지 않고(output null) 같은 치환을 제안으로만 낸다
        code: `const A = () => <div style={{ color: "#3b82f6" }} />;`,
        ...at(stale, "src/stale.jsx"),
        output: null,
        errors: [
          {
            message: /^\[guard\.json 낡음: tokens\.css 변경됨.*\] 하드코딩 color #3b82f6/,
            suggestions: [
              {
                messageId: "replaceStale",
                data: { token: "--color-blue-500" },
                output: `const A = () => <div style={{ color: "var(--color-blue-500)" }} />;`,
              },
            ],
          },
        ],
      },
      {
        // 안내는 파일의 첫 메시지에만 붙는다
        code: `const A = () => <div style={{ color: "#3b82f6", padding: 8 }} />;`,
        ...at(stale, "src/stale-two.jsx"),
        output: null,
        errors: [
          { message: /^\[guard\.json 낡음: tokens\.css/, suggestions: 1 },
          { message: /^하드코딩 padding/, suggestions: 1 },
        ],
      },
      {
        // reportIneligible: true → width도 보고(치환 없음)
        code: `const A = () => <div style={{ width: 100 }} />;`,
        options: [{ reportIneligible: true }],
        ...at(plain, "src/ineligible.jsx"),
        output: null,
        errors: [{ message: /토큰 치환 대상 아님/ }],
      },
    ],
  });
});

describe("prefer-ds-component", () => {
  tester.run("prefer-ds-component", plugin.rules["prefer-ds-component"], {
    valid: [
      { code: `import { Button } from "../components/ui/button";\nexport const A = () => <Button />;`, ...at(withDs, "src/ok.jsx") },
      // 골격(scaffold)은 권하지 않는다
      { code: `import { Card } from "./legacy/Card";\nexport const A = () => <Card />;`, ...at(withDs, "src/scaffold.jsx") },
      // 스냅샷 없음
      { code: `import { Button } from "./legacy/Button";\nexport const A = () => <Button />;`, filename: bare.abs("src/a.jsx") },
      // 결정(preferred)과 같은 module
      { code: `import { Modal } from "../components/ui/modal";\nexport const A = () => <Modal />;`, ...at(withDs, "src/pref-ok.jsx") },
      // 별칭·namespace여도 DS 모듈이면 통과
      { code: `import { Button as B } from "../components/ui/button";\nexport const A = () => <B />;`, ...at(withDs, "src/alias-ok.jsx") },
      { code: `import * as UI from "../components/ui/button";\nexport const A = () => <UI.Button />;`, ...at(withDs, "src/ns-ok.jsx") },
      // DS에 없는 이름으로 가져온 별칭은 대상 아님
      { code: `import { Foo as Button } from "./legacy/foo";\nexport const A = () => <Button />;`, ...at(withDs, "src/alias-other.jsx") },
    ],
    invalid: [
      {
        code: `import { Button } from "./legacy/Button";\nexport const A = () => <Button />;`,
        ...at(withDs, "src/legacy-btn.jsx"),
        errors: [{ message: "Button은 DS 컴포넌트(components/ui/button)를 쓰세요", line: 2, column: 24 }],
      },
      {
        // 결정(preferred) 위반
        code: `import { Modal } from "./old/modal";\nexport const A = () => <Modal open />;`,
        ...at(withDs, "src/pref.jsx"),
        errors: [{ message: "Modal은 DS 컴포넌트(components/ui/modal)를 쓰세요", line: 2, column: 24 }],
      },
      {
        // 이 파일에 선언한 같은 이름 컴포넌트
        code: `function Button() { return null; }\nexport const A = () => <Button />;`,
        ...at(withDs, "src/local.jsx"),
        errors: [{ messageId: "finding", line: 2, column: 24 }],
      },
      {
        // 별칭 import
        code: `import { Button as LegacyBtn } from "./legacy/Button";\nexport const A = () => <LegacyBtn />;`,
        ...at(withDs, "src/alias.jsx"),
        errors: [{ message: "Button은 DS 컴포넌트(components/ui/button)를 쓰세요", line: 2, column: 24 }],
      },
      {
        // namespace import
        code: `import * as L from "./legacy/Button";\nexport const A = () => <L.Button />;`,
        ...at(withDs, "src/ns.jsx"),
        errors: [{ message: "Button은 DS 컴포넌트(components/ui/button)를 쓰세요", line: 2, column: 24 }],
      },
      {
        // 같은 줄에 Button.Group이 먼저 있어도 정확히 Button인 태그에 보고
        code: `import { Button } from "./legacy/Button";\nexport const A = () => <><Button.Group /><Button /></>;`,
        ...at(withDs, "src/same-line.jsx"),
        errors: [{ messageId: "finding", line: 2, column: 42 }],
      },
    ],
  });
});

describe("no-deprecated-component", () => {
  tester.run("no-deprecated-component", plugin.rules["no-deprecated-component"], {
    valid: [
      { code: `import { Button } from "../components/ui/button";\nexport const A = () => <Button />;`, ...at(withDs, "src/dep-ok.jsx") },
      { code: `import { Dialog } from "../components/ui/dialog";\nexport const A = () => <Dialog />;`, filename: bare.abs("src/dep-none.jsx") },
      // 다른 모듈에서 Dialog라는 로컬 이름으로 가져온 다른 컴포넌트
      { code: `import { Foo as Dialog } from "../components/ui/dialog";\nexport const A = () => <Dialog />;`, ...at(withDs, "src/dep-alias-other.jsx") },
    ],
    invalid: [
      {
        code: `import { Dialog as Dlg } from "../components/ui/dialog";\nexport const A = () => <Dlg />;`,
        ...at(withDs, "src/dep-alias.jsx"),
        errors: [{ message: "Dialog은 deprecated: Use Modal", line: 2, column: 24 }],
      },
      {
        code: `import * as UI from "../components/ui/dialog";\nexport const A = () => <UI.Dialog />;`,
        ...at(withDs, "src/dep-ns.jsx"),
        errors: [{ message: "Dialog은 deprecated: Use Modal", line: 2, column: 24 }],
      },
      {
        code: `import { Dialog } from "../components/ui/dialog";\nexport const A = () => <Dialog />;`,
        ...at(withDs, "src/dep.jsx"),
        errors: [{ message: "Dialog은 deprecated: Use Modal", line: 2, column: 24 }],
      },
    ],
  });
});
