import { extractorMatchers } from "@dsmith-dev/core";
import type { ExtractContext, Extractor, StyleUsage } from "@dsmith-dev/extractor-api";
import { describe, expect, it } from "vitest";
import { checkComponents, checkEdit } from "../src/verify.js";
import { ALL } from "./helpers.js";

/** 파일의 `H`는 hardcoded color, `T`는 token을 `tokenAs`(속성)로 읽는 가짜 Extractor */
function probe(tokenAs: StyleUsage["property"]): Extractor {
  return {
    name: "probe",
    files: ["**/*.tsx"],
    parses: "none",
    appliesTo: () => true,
    extract(ctx: ExtractContext): StyleUsage[] {
      const out: StyleUsage[] = [];
      for (const [i, ch] of [...ctx.code].entries()) {
        if (ch === "H") out.push({ file: ctx.file, line: 1, column: i, property: "background-color", raw: "H", normalized: { kind: "unknown" }, source: "hardcoded", extractor: "probe" });
        if (ch === "T") out.push({ file: ctx.file, line: 1, column: i, property: tokenAs, raw: "T", normalized: { kind: "unknown" }, source: "token", extractor: "probe" });
      }
      return out;
    },
    write: () => null,
  };
}

const check = (extractor: Extractor, expected: StyleUsage["property"][]) =>
  checkEdit("/x", "a.tsx", "const a = 'H';", "const a = 'T';", expected, extractorMatchers([extractor]));

describe("checkEdit — 속성까지 확인한다 (I1)", () => {
  it("hardcoded가 줄고 token이 같은 속성으로 늘면 통과", () => {
    expect(check(probe("background-color"), ["background-color"])).toBeNull();
  });

  it("개수는 맞아도 token이 다른 속성으로 읽히면 실패", () => {
    const bad = check(probe("other"), ["background-color"]);
    expect(bad).toMatch(/^재추출 검증 실패: 속성이 달라짐/);
    expect(bad).toContain("background-color");
    expect(bad).toContain("other");
  });

  it("계획과 다른 속성의 사용이 바뀌어도 실패", () => {
    expect(check(probe("background-color"), ["color"])).toMatch(/^재추출 검증 실패: 속성이 달라짐/);
  });

  it("개수가 어긋나면 기존 메시지", () => {
    expect(check(probe("background-color"), ["background-color", "background-color"])).toMatch(/^재추출 검증 실패: hardcoded 1→0, token 0→1/);
  });
});

describe("checkEdit — 실제 Extractor에서 단축 속성은 통과한다", () => {
  const matchers = extractorMatchers(ALL);
  it.each([
    ["a.css", ".a { background: #ffffff; }\n", ".a { background: var(--c); }\n", ["background-color"]],
    ["a.css", ".a { border: 1px solid #111827; }\n", ".a { border: 1px solid var(--c); }\n", ["border-color"]],
    ["a.css", ".a { border-top: 2px solid #111827; }\n", ".a { border-top: 2px solid var(--c); }\n", ["border-color"]],
    ["B.tsx", 'export const B = () => <div style={{ background: "#ffffff" }} />;\n', 'export const B = () => <div style={{ background: "var(--c)" }} />;\n', ["background-color"]],
  ] as const)("%s", (file, before, after, props) => {
    expect(checkEdit("/x", file, before, after, [...props], matchers)).toBeNull();
  });

  it("background: <색> url() 처럼 단축 속성의 일부만 바꾸면 token으로 읽히지 않아 실패", () => {
    const bad = checkEdit("/x", "a.css", ".a { background: #fff url(x.png); }\n", ".a { background: var(--c) url(x.png); }\n", ["background-color"], matchers);
    expect(bad).toMatch(/^재추출 검증 실패/);
  });
});

describe("checkComponents", () => {
  const env = { tsPaths: null, moduleContext: {} };
  const check = [{ item: "Button", module: "src/ui/button" }];

  it("옮긴 항목의 사용이 기대한 module에서 오면 통과", () => {
    const after = 'import { Button } from "../ui/button";\nexport const A = () => <Button />;\n';
    expect(checkComponents("src/pages/a.tsx", after, check, env)).toBeNull();
  });

  it("별칭으로 가져온 사용(Btn)도 가져온 원래 이름으로 맞춰 검사한다", () => {
    const ok = 'import { Button as Btn } from "../ui/button";\nexport const A = () => <Btn />;\n';
    expect(checkComponents("src/pages/a.tsx", ok, check, env)).toBeNull();
    const wrong = 'import { Button as Btn } from "../legacy/button";\nexport const A = () => <Btn />;\n';
    expect(checkComponents("src/pages/a.tsx", wrong, check, env)).toMatch(/Button\(2줄\)이 src\/legacy\/button에서 옴/);
  });

  it("옮긴 이름의 import가 사라져 module을 알 수 없게 되면 실패", () => {
    const after = "export const A = () => <Button />;\n";
    expect(checkComponents("src/pages/a.tsx", after, check, env)).toMatch(/import를 찾을 수 없음/);
    const aliased = "export const A = () => <Btn />;\n";
    expect(checkComponents("src/pages/a.tsx", aliased, check, env)).toBeNull(); // 이름이 다르면 다른 컴포넌트
  });

  it("지역 선언은 보지 않는다", () => {
    const after = "function Button() { return null; }\nexport const A = () => <Button />;\n";
    expect(checkComponents("src/pages/a.tsx", after, check, env)).toBeNull();
  });
});
