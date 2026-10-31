import { runConformance, type ConformanceCase } from "@ds-cli/extractor-api";
import { describe, expect, it } from "vitest";
import { cssPropertyToStyleProperty, inlineStyleExtractor } from "../src/index.js";

const cases: ConformanceCase[] = [
  {
    file: "a.tsx",
    code: `export const A = () => <div style={{ color: "#3B82F6", padding: 12 }} />;`,
    expect: [
      {
        property: "color",
        raw: "#3B82F6",
        source: "hardcoded",
        normalized: { kind: "color", hex: "#3b82f6" },
      },
      { property: "padding", raw: "12", source: "hardcoded", normalized: { kind: "length", px: 12 } },
    ],
  },
  {
    file: "b.tsx",
    code: `export const B = () => <div style={{ padding: "1.5rem" }} />;`,
    expect: [{ property: "padding", normalized: { kind: "length", px: 24 } }],
  },
  {
    file: "c.tsx",
    code: `export const C = () => <div style={{ color: theme.primary }} />;`,
    expect: [
      { property: "color", raw: "theme.primary", source: "dynamic", normalized: { kind: "unknown" } },
    ],
  },
];

describe("inlineStyleExtractor", () => {
  it("conformance 케이스를 모두 통과한다", () => {
    const report = runConformance("inline-style", () => inlineStyleExtractor, cases);
    expect(report.failed).toEqual([]);
    expect(report.passed).toBe(cases.length);
  });

  it("name은 inline-style이다", () => {
    expect(inlineStyleExtractor.name).toBe("inline-style");
  });

  it("style={styles.box}는 usage를 만들지 않는다", () => {
    const code = `export const D = () => <div style={styles.box} />;`;
    expect(inlineStyleExtractor.extract({ root: "/", file: "d.tsx", code })).toEqual([]);
  });

  it("appliesTo는 .tsx/.jsx이면서 style=이 있을 때만 true다", () => {
    const code = `<div style={{ color: "red" }} />`;
    const ctx = (file: string, c: string) => ({ root: "/", file, code: c });
    expect(inlineStyleExtractor.appliesTo(ctx("a.tsx", code))).toBe(true);
    expect(inlineStyleExtractor.appliesTo(ctx("a.jsx", code))).toBe(true);
    expect(inlineStyleExtractor.appliesTo(ctx("a.ts", code))).toBe(false);
    expect(inlineStyleExtractor.appliesTo(ctx("a.css", code))).toBe(false);
    expect(inlineStyleExtractor.appliesTo(ctx("a.tsx", `<div className="x" />`))).toBe(false);
  });

  it("line은 1-based, column은 0-based로 값 노드 위치를 가리킨다", () => {
    const code = `const x = (\n  <div style={{ color: "#fff" }} />\n);`;
    const [usage] = inlineStyleExtractor.extract({ root: "/", file: "e.tsx", code });
    expect(usage).toMatchObject({ file: "e.tsx", line: 2, column: 23, extractor: "inline-style" });
  });

  it("문자열 키, spread, computed 키를 처리한다", () => {
    const code = `const x = <div style={{ ...base, "backgroundColor": "red", [key]: "blue", margin: "8px" }} />;`;
    const usages = inlineStyleExtractor.extract({ root: "/", file: "f.tsx", code });
    expect(usages.map((u) => [u.property, u.raw])).toEqual([
      ["background-color", "red"],
      ["margin", "8px"],
    ]);
  });

  it("정규화할 수 없는 문자열은 hardcoded + unknown이다", () => {
    const code = `const x = <div style={{ color: "var(--c)", padding: "auto" }} />;`;
    const usages = inlineStyleExtractor.extract({ root: "/", file: "g.tsx", code });
    expect(usages).toHaveLength(2);
    for (const u of usages) {
      expect(u.source).toBe("hardcoded");
      expect(u.normalized).toEqual({ kind: "unknown" });
    }
  });

  it("값 표현식은 소스 텍스트를 raw로 보존한다", () => {
    const code = "const x = <div style={{ width: size * 2, height: `${h}px` }} />;";
    const usages = inlineStyleExtractor.extract({ root: "/", file: "h.tsx", code });
    expect(usages.map((u) => [u.property, u.raw, u.source])).toEqual([
      ["width", "size * 2", "dynamic"],
      ["height", "`${h}px`", "dynamic"],
    ]);
  });

  it("복구 불가능한 문법 오류는 예외 대신 빈 배열을 돌려준다", () => {
    const code = `const x = <div style={{ color: "red" }} />;\nconst = ;`;
    expect(inlineStyleExtractor.extract({ root: "/", file: "i.tsx", code })).toEqual([]);
  });
});

describe("cssPropertyToStyleProperty", () => {
  it.each([
    ["color", "color"],
    ["backgroundColor", "background-color"],
    ["borderColor", "border-color"],
    ["borderTopColor", "border-color"],
    ["fill", "fill"],
    ["stroke", "stroke"],
    ["padding", "padding"],
    ["paddingLeft", "padding"],
    ["margin", "margin"],
    ["marginTop", "margin"],
    ["gap", "gap"],
    ["rowGap", "gap"],
    ["columnGap", "gap"],
    ["width", "width"],
    ["minWidth", "width"],
    ["maxWidth", "width"],
    ["height", "height"],
    ["minHeight", "height"],
    ["maxHeight", "height"],
    ["fontSize", "font-size"],
    ["borderRadius", "border-radius"],
    ["borderTopLeftRadius", "border-radius"],
    ["opacity", "other"],
    ["zIndex", "other"],
  ])("%s -> %s", (input, expected) => {
    expect(cssPropertyToStyleProperty(input)).toBe(expected);
  });
});
