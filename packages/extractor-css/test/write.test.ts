import type { StyleUsage, WritePatch } from "@dsmith-dev/extractor-api";
import { runConformance } from "@dsmith-dev/extractor-api";
import { describe, expect, it } from "vitest";
import { cssExtractor } from "../src/index.js";

function find(code: string, raw: string): StyleUsage {
  const usage = cssExtractor.extract({ root: "/", file: "s/a.css", code }).find((u) => u.raw === raw);
  if (usage === undefined) throw new Error(`usage 없음: ${raw}`);
  return usage;
}

function apply(code: string, patch: WritePatch): string {
  return code.slice(0, patch.start) + patch.replacement + code.slice(patch.end);
}

describe("cssExtractor.write", () => {
  const code = ".btn { color: #3B82F6; padding: 13px; border: 1px solid #000; }";

  it("값 구간만 tokenRef로 치환한다(따옴표 없음)", () => {
    const patch = cssExtractor.write(find(code, "#3B82F6"), "var(--color-primary-500)")!;
    expect(patch.file).toBe("s/a.css");
    expect(code.slice(patch.start, patch.end)).toBe("#3B82F6");
    expect(patch.replacement).toBe("var(--color-primary-500)");
    expect(apply(code, patch)).toBe(
      ".btn { color: var(--color-primary-500); padding: 13px; border: 1px solid #000; }",
    );
  });

  it("축약은 색 토큰 구간만 치환한다", () => {
    const patch = cssExtractor.write(find(code, "#000"), "var(--border)")!;
    expect(apply(code, patch)).toBe(
      ".btn { color: #3B82F6; padding: 13px; border: 1px solid var(--border); }",
    );
  });

  it("여러 값 길이 속성은 정규화한 첫 토큰만 치환한다", () => {
    const text = "a { padding: 13px 8px; }";
    const patch = cssExtractor.write(find(text, "13px"), "var(--space-3)")!;
    expect(apply(text, patch)).toBe("a { padding: var(--space-3) 8px; }");
  });

  it("주석이 있어도 패치 위치가 원본과 일치한다", () => {
    const text = "a { /* x: y */ margin: 4px; }";
    const patch = cssExtractor.write(find(text, "4px"), "var(--m)")!;
    expect(apply(text, patch)).toBe("a { /* x: y */ margin: var(--m); }");
  });

  it("token usage와 이 추출기가 만들지 않은 usage는 null", () => {
    expect(cssExtractor.write(find("a{color:var(--c)}", "var(--c)"), "var(--x)")).toBeNull();
    const foreign: StyleUsage = {
      file: "a.css",
      line: 1,
      column: 0,
      property: "color",
      raw: "#fff",
      normalized: { kind: "unknown" },
      source: "hardcoded",
      extractor: "css",
    };
    expect(cssExtractor.write(foreign, "var(--x)")).toBeNull();
  });
});

describe("cssExtractor.write: 점수 대상이 아닌 usage", () => {
  it("other 속성(content·font-family·box-shadow)과 정규화 안 된 값(calc)은 null", () => {
    const code = `.a { content: "가😀"; font-family: Inter; box-shadow: 0 1px 2px #000; width: calc(100% - 8px); color: #fff; }`;
    const usages = cssExtractor.extract({ root: "/", file: "a.css", code });
    expect(usages.map((u) => [u.property, cssExtractor.write(u, "var(--x)") === null])).toEqual([
      ["other", true],
      ["other", true],
      ["other", true],
      ["width", true],
      ["color", false],
    ]);
  });
});

describe("cssExtractor.tokenRef + conformance write 왕복", () => {
  const blue = { name: "--color-blue-500", value: "#3b82f6", category: "color" as const, normalized: { kind: "color" as const, hex: "#3b82f6", l: 0.62, c: 0.2, h: 260 } };
  const bg = { name: "--color-bg", value: "#fff", category: "color" as const, normalized: { kind: "color" as const, hex: "#ffffff", l: 1, c: 0, h: 0 } };
  const space = { name: "--space-2", value: "8px", category: "spacing" as const, normalized: { kind: "length" as const, px: 8 } };
  const radius = { name: "--radius-sm", value: "4px", category: "radius" as const, normalized: { kind: "length" as const, px: 4 } };

  it("tokenRef는 var(--x)이고 CSS 변수가 아닌 이름은 null", () => {
    const usage = find(".a{color:#fff}", "#fff");
    expect(cssExtractor.tokenRef!(bg, usage, {})).toBe("var(--color-bg)");
    expect(cssExtractor.tokenRef!({ ...bg, name: "color.bg" }, usage, {})).toBeNull();
  });

  it("write 왕복: 색·간격·모서리 치환 뒤 token으로 읽히고 나머지는 그대로", () => {
    const report = runConformance("css", () => cssExtractor, [
      {
        file: "a.css",
        code: ".a { color: #3b82f6; padding: 8px; border-radius: 4px; }",
        expect: [],
        writes: [
          { target: { property: "color" }, token: blue, ref: "var(--color-blue-500)", output: ".a { color: var(--color-blue-500); padding: 8px; border-radius: 4px; }", reextract: { source: "token", property: "color" } },
          { target: { property: "padding" }, token: space, ref: "var(--space-2)", output: ".a { color: #3b82f6; padding: var(--space-2); border-radius: 4px; }", reextract: { source: "token", property: "padding" } },
          { target: { property: "border-radius" }, token: radius, ref: "var(--radius-sm)", reextract: { source: "token", property: "border-radius" } },
        ],
      },
      {
        file: "a.css",
        code: ".a { border: 1px solid #3b82f6; }",
        expect: [],
        writes: [{ target: { raw: "#3b82f6" }, token: blue, ref: "var(--color-blue-500)", output: ".a { border: 1px solid var(--color-blue-500); }", reextract: { source: "token", property: "border-color" } }],
      },
      {
        file: "a.css",
        code: ".a { background: #fff; }",
        expect: [],
        writes: [{ target: { raw: "#fff" }, token: bg, ref: "var(--color-bg)", output: ".a { background: var(--color-bg); }", reextract: { source: "token", property: "background-color" } }],
      },
      {
        file: "a.css",
        code: ".a { color: #fff; }",
        expect: [],
        writes: [{ target: { property: "color" }, token: { ...bg, name: "color.bg" }, ref: null, reextract: {} }],
      },
    ]);
    expect(report.failed).toEqual([]);
    expect(report.passed).toBe(4);
  });
});
