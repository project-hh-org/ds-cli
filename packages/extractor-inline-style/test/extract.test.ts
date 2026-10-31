import { JS_FILES, metaOf, runConformance, type ConformanceCase } from "@dsmith/extractor-api";
import { parseTsx } from "@dsmith/core";
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
  {
    file: "d.tsx",
    code: `export const D = () => <div style={{ margin: -4 }} />;`,
    expect: [
      { property: "margin", raw: "-4", source: "hardcoded", normalized: { kind: "length", px: -4 } },
    ],
  },
  {
    file: "e.tsx",
    code: `export const E = () => <div style={{ background: "#EF4444" }} />;`,
    expect: [
      {
        property: "background-color",
        raw: "#EF4444",
        source: "hardcoded",
        normalized: { kind: "color", hex: "#ef4444" },
      },
    ],
  },
  {
    file: "f.tsx",
    code: `export const F = () => <div style={{ background: "url(x.png)" }} />;`,
    expect: [{ property: "other", source: "hardcoded", normalized: { kind: "unknown" } }],
  },
  {
    file: "g.tsx",
    code: `export const G = () => <div style={{ border: "#ef4444", outline: "rgb(0, 0, 0)" }} />;`,
    expect: [
      { property: "border-color", normalized: { kind: "color", hex: "#ef4444" } },
      { property: "border-color", normalized: { kind: "color", hex: "#000000" } },
    ],
  },
  {
    file: "h.tsx",
    code: `export const H = () => <div style={{ border: "1px solid #ef4444", background: theme.bg }} />;`,
    expect: [
      { property: "other", source: "hardcoded", normalized: { kind: "unknown" } },
      { property: "other", source: "dynamic", normalized: { kind: "unknown" } },
    ],
  },
  {
    file: "i.tsx",
    code: `export const I = () => <div style={{ color: "var(--x)", padding: " var(--space-2) " }} />;`,
    expect: [
      { property: "color", raw: "var(--x)", source: "token", normalized: { kind: "unknown" } },
      { property: "padding", source: "token", normalized: { kind: "unknown" } },
    ],
  },
  {
    file: "src/App.js",
    code: `export const App = () => <div style={{ color: "#3B82F6", margin: 8 }} />;`,
    expect: [
      { property: "color", source: "hardcoded", normalized: { kind: "color", hex: "#3b82f6" } },
      { property: "margin", source: "hardcoded", normalized: { kind: "length", px: 8 } },
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

  it("메타는 JS_FILES를 대상으로 하고 tsx를 파싱한다", () => {
    expect(metaOf(inlineStyleExtractor)).toEqual({
      name: "inline-style",
      files: JS_FILES,
      parses: "tsx",
    });
  });

  it("style={styles.box}는 usage를 만들지 않는다", () => {
    const code = `export const D = () => <div style={styles.box} />;`;
    expect(inlineStyleExtractor.extract({ root: "/", file: "d.tsx", code })).toEqual([]);
  });

  it("appliesTo는 JS/TS 소스(.js/.jsx/.ts/.tsx, .mjs/.cjs 등)이면서 style=이 있을 때만 true다", () => {
    const code = `<div style={{ color: "red" }} />`;
    const ctx = (file: string, c: string) => ({ root: "/", file, code: c });
    for (const file of ["a.tsx", "a.jsx", "a.js", "a.ts", "a.mjs", "a.cjs", "a.mts", "a.cts"]) {
      expect(inlineStyleExtractor.appliesTo(ctx(file, code)), file).toBe(true);
    }
    expect(inlineStyleExtractor.appliesTo(ctx("a.css", code))).toBe(false);
    expect(inlineStyleExtractor.appliesTo(ctx("a.json", code))).toBe(false);
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
    const code = `const x = <div style={{ color: "currentColor", padding: "auto" }} />;`;
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

  it("숫자 리터럴은 길이 속성에서만 px로 정규화한다", () => {
    const code =
      "const x = <div style={{ opacity: 0.5, zIndex: 10, fontWeight: 600, color: 0, padding: 12, lineHeight: 1.50, margin: -4 }} />;";
    const usages = inlineStyleExtractor.extract({ root: "/", file: "k.tsx", code });
    expect(usages.map((u) => [u.property, u.raw, u.source, u.normalized])).toEqual([
      ["other", "0.5", "hardcoded", { kind: "unknown" }],
      ["other", "10", "hardcoded", { kind: "unknown" }],
      ["other", "600", "hardcoded", { kind: "unknown" }],
      ["color", "0", "hardcoded", { kind: "unknown" }],
      ["padding", "12", "hardcoded", { kind: "length", px: 12 }],
      ["other", "1.50", "hardcoded", { kind: "unknown" }],
      ["margin", "-4", "hardcoded", { kind: "length", px: -4 }],
    ]);
  });

  it("숫자 raw는 원본 소스 텍스트를 보존한다", () => {
    const code = "const x = <div style={{ width: 1.50, height: -2.0 }} />;";
    const usages = inlineStyleExtractor.extract({ root: "/", file: "l.tsx", code });
    expect(usages.map((u) => [u.raw, u.normalized])).toEqual([
      ["1.50", { kind: "length", px: 1.5 }],
      ["-2.0", { kind: "length", px: -2 }],
    ]);
  });

  it("비길이 숫자 리터럴도 치환 패치는 만든다", () => {
    const code = "const x = <div style={{ opacity: 0.5 }} />;";
    const [usage] = inlineStyleExtractor.extract({ root: "/", file: "m.tsx", code });
    const patch = inlineStyleExtractor.write(usage!, "var(--opacity-half)")!;
    expect(code.slice(patch.start, patch.end)).toBe("0.5");
  });

  it("복구 불가능한 문법 오류는 parseTsx와 마찬가지로 예외를 던진다", () => {
    const code = `const x = <div style={{ color: "red" }} />;\nconst = ;`;
    expect(() => parseTsx(code, "i.tsx")).toThrow();
    expect(() => inlineStyleExtractor.extract({ root: "/", file: "i.tsx", code })).toThrow();
  });

  it("단항 +/- 숫자 리터럴은 hardcoded length다", () => {
    const code = "const x = <div style={{ margin: -4, padding: +2, left: -x }} />;";
    const usages = inlineStyleExtractor.extract({ root: "/", file: "j.tsx", code });
    expect(usages.map((u) => [u.raw, u.source, u.normalized])).toEqual([
      ["-4", "hardcoded", { kind: "length", px: -4 }],
      ["2", "hardcoded", { kind: "length", px: 2 }],
      ["-x", "dynamic", { kind: "unknown" }],
    ]);
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
