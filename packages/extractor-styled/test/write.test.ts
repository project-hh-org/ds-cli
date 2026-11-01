import { runConformance } from "@dsmith-dev/extractor-api";
import type { StyleUsage, WritePatch } from "@dsmith-dev/extractor-api";
import { describe, expect, it } from "vitest";
import { styledExtractor } from "../src/index.js";

const SC = `import styled from "styled-components";\n`;

function find(code: string, raw: string): StyleUsage {
  const usage = styledExtractor.extract({ root: "/", file: "s/a.tsx", code }).find((u) => u.raw === raw);
  if (usage === undefined) throw new Error(`usage 없음: ${raw}`);
  return usage;
}

function apply(code: string, patch: WritePatch): string {
  return code.slice(0, patch.start) + patch.replacement + code.slice(patch.end);
}

describe("styledExtractor.write", () => {
  it("템플릿 값 구간을 tokenRef 그대로 치환한다", () => {
    const code = `${SC}const B = styled.button\`color:#3B82F6;padding:13px 8px;\`;`;
    const patch = styledExtractor.write(find(code, "#3B82F6"), "var(--color-primary-500)")!;
    expect(patch.file).toBe("s/a.tsx");
    expect(code.slice(patch.start, patch.end)).toBe("#3B82F6");
    expect(apply(code, patch)).toBe(
      `${SC}const B = styled.button\`color:var(--color-primary-500);padding:13px 8px;\`;`,
    );
  });

  it("여러 값 길이 속성은 첫 토큰만 치환한다", () => {
    const code = `${SC}const B = styled.div\`padding: 13px 8px;\`;`;
    const patch = styledExtractor.write(find(code, "13px"), "var(--space-3)")!;
    expect(apply(code, patch)).toBe(`${SC}const B = styled.div\`padding: var(--space-3) 8px;\`;`);
  });

  it("${} 뒤의 값도 원본 위치로 치환한다", () => {
    const code = `${SC}const B = styled.div\`\n  \${mixin}\n  color: \${c}; border: 1px solid #000;\n\`;`;
    const patch = styledExtractor.write(find(code, "#000"), "${theme.border}")!;
    expect(apply(code, patch)).toBe(
      `${SC}const B = styled.div\`\n  \${mixin}\n  color: \${c}; border: 1px solid \${theme.border};\n\`;`,
    );
  });

  it("객체 문법 문자열 값은 따옴표 안을, 숫자 값은 문자열 리터럴로 치환한다", () => {
    const code = `${SC}const B = styled.div({ color: "#fff", padding: 12 });`;
    const color = styledExtractor.write(find(code, "#fff"), "var(--c)")!;
    expect(code.slice(color.start, color.end)).toBe("#fff");
    expect(apply(code, color)).toBe(`${SC}const B = styled.div({ color: "var(--c)", padding: 12 });`);
    const padding = styledExtractor.write(find(code, "12"), "var(--s)")!;
    expect(apply(code, padding)).toBe(`${SC}const B = styled.div({ color: "#fff", padding: "var(--s)" });`);
  });

  it("객체 문법 여러 값 문자열(`padding: \"13px 8px\"`)은 13px 구간만 치환한다", () => {
    const code = `${SC}const B = styled.div({ padding: "13px 8px" });`;
    const usage = find(code, "13px");
    expect(usage).toMatchObject({ property: "padding", normalized: { kind: "length", px: 13 } });
    const patch = styledExtractor.write(usage, "var(--space-3)")!;
    expect(code.slice(patch.start, patch.end)).toBe("13px");
    expect(apply(code, patch)).toBe(`${SC}const B = styled.div({ padding: "var(--space-3) 8px" });`);
  });

  it("dynamic·token usage와 남이 만든 usage는 null", () => {
    const code = `${SC}const B = styled.div\`color: \${c}; margin: var(--m);\`;`;
    const usages = styledExtractor.extract({ root: "/", file: "a.tsx", code });
    expect(usages.map((u) => styledExtractor.write(u, "x"))).toEqual([null, null]);
    const foreign: StyleUsage = { ...usages[0]!, source: "hardcoded" };
    expect(styledExtractor.write(foreign, "x")).toBeNull();
  });
});

describe("styledExtractor.write: 점수 대상이 아닌 usage", () => {
  it("템플릿·객체의 other 속성과 정규화 안 된 값은 null", () => {
    const code = `${SC}const A = styled.div\`box-shadow: 0 1px 2px #000; content: "가😀";\`;\nconst B = styled.div({ fontFamily: "Inter", width: "calc(100% - 8px)", color: "#fff" });`;
    const usages = styledExtractor.extract({ root: "/", file: "a.tsx", code });
    expect(usages.map((u) => [u.property, styledExtractor.write(u, "var(--x)") === null])).toEqual([
      ["other", true],
      ["other", true],
      ["other", true],
      ["width", true],
      ["color", false],
    ]);
  });
});

describe("styledExtractor.tokenRef + conformance write 왕복", () => {
  const blue = { name: "--color-blue-500", value: "#3b82f6", category: "color" as const, normalized: { kind: "color" as const, hex: "#3b82f6", l: 0.62, c: 0.2, h: 260 } };
  const space = { name: "--space-2", value: "8px", category: "spacing" as const, normalized: { kind: "length" as const, px: 8 } };
  const radius = { name: "--radius-sm", value: "4px", category: "radius" as const, normalized: { kind: "length" as const, px: 4 } };
  const text = { name: "--text-xs", value: "12px", category: "font-size" as const, normalized: { kind: "length" as const, px: 12 } };

  it("템플릿과 객체 문법 모두 왕복한다", () => {
    const report = runConformance("styled", () => styledExtractor, [
      {
        file: "s/a.tsx",
        code: `${SC}const B = styled.button\`color: #3b82f6;\n  padding: 8px;\`;`,
        expect: [],
        writes: [
          { target: { property: "color" }, token: blue, ref: "var(--color-blue-500)", output: `${SC}const B = styled.button\`color: var(--color-blue-500);\n  padding: 8px;\`;`, reextract: { source: "token", property: "color" } },
          { target: { property: "padding" }, token: space, ref: "var(--space-2)", reextract: { source: "token", property: "padding" } },
        ],
      },
      {
        file: "s/a.tsx",
        code: `${SC}const B = styled.div({\n  fontSize: 12,\n  color: "#3b82f6",\n});`,
        expect: [],
        writes: [
          { target: { property: "font-size" }, token: text, ref: "var(--text-xs)", output: `${SC}const B = styled.div({\n  fontSize: "var(--text-xs)",\n  color: "#3b82f6",\n});`, reextract: { source: "token", property: "font-size" } },
          { target: { property: "color" }, token: { ...blue, name: "color.brand" }, ref: null, reextract: {} },
        ],
      },
    ]);
    expect(report.failed).toEqual([]);
    expect(report.passed).toBe(2);
  });
});
