import { runConformance } from "@dsmith-dev/extractor-api";
import type { StyleUsage, WritePatch } from "@dsmith-dev/extractor-api";
import { describe, expect, it } from "vitest";
import { emotionExtractor } from "../src/index.js";

function find(code: string, raw: string): StyleUsage {
  const usage = emotionExtractor.extract({ root: "/", file: "e.tsx", code }).find((u) => u.raw === raw);
  if (usage === undefined) throw new Error(`usage 없음: ${raw}`);
  return usage;
}

function apply(code: string, patch: WritePatch): string {
  return code.slice(0, patch.start) + patch.replacement + code.slice(patch.end);
}

describe("emotionExtractor.write", () => {
  it("템플릿 값 구간을 tokenRef 그대로 치환한다", () => {
    const code = `import styled from "@emotion/styled";\nconst B = styled.div\`color: #fff; padding: 4px;\`;`;
    const patch = emotionExtractor.write(find(code, "#fff"), "var(--fg)")!;
    expect(patch.file).toBe("e.tsx");
    expect(apply(code, patch)).toBe(
      `import styled from "@emotion/styled";\nconst B = styled.div\`color: var(--fg); padding: 4px;\`;`,
    );
  });

  it("css prop 객체 값은 문자열 리터럴로 치환한다", () => {
    const code = `const a = <div css={{ color: "#fff", padding: 12 }} />;`;
    const patch = emotionExtractor.write(find(code, "12"), "var(--s)")!;
    expect(apply(code, patch)).toBe(`const a = <div css={{ color: "#fff", padding: "var(--s)" }} />;`);
  });

  it("dynamic은 null", () => {
    const code = `const a = <div css={{ color: theme.fg }} />;`;
    expect(emotionExtractor.write(find(code, "theme.fg"), "var(--fg)")).toBeNull();
  });
});

describe("emotionExtractor.write: 점수 대상이 아닌 usage", () => {
  it("css prop의 other 속성(content·boxShadow)과 정규화 안 된 값은 null", () => {
    const code = `const a = <div css={{ content: "가😀", boxShadow: "0 1px 2px #000", height: "100dvh", color: "#fff" }} />;`;
    const usages = emotionExtractor.extract({ root: "/", file: "e.tsx", code });
    expect(usages.map((u) => [u.property, emotionExtractor.write(u, "var(--x)") === null])).toEqual([
      ["other", true],
      ["other", true],
      ["height", true],
      ["color", false],
    ]);
  });
});

describe("emotionExtractor.tokenRef + conformance write 왕복", () => {
  const blue = { name: "--color-blue-500", value: "#3b82f6", category: "color" as const, normalized: { kind: "color" as const, hex: "#3b82f6", l: 0.62, c: 0.2, h: 260 } };
  const space = { name: "--space-2", value: "8px", category: "spacing" as const, normalized: { kind: "length" as const, px: 8 } };
  const radius = { name: "--radius-sm", value: "4px", category: "radius" as const, normalized: { kind: "length" as const, px: 4 } };
  const text = { name: "--text-xs", value: "12px", category: "font-size" as const, normalized: { kind: "length" as const, px: 12 } };

  it("css prop 객체·styled 템플릿 모두 왕복한다", () => {
    const report = runConformance("emotion", () => emotionExtractor, [
      {
        file: "e.tsx",
        code: 'const A = () => <div css={{ fontSize: 12, color: "#3b82f6", padding: "8px" }} />;',
        expect: [],
        writes: [
          { target: { property: "font-size" }, token: text, ref: "var(--text-xs)", output: 'const A = () => <div css={{ fontSize: "var(--text-xs)", color: "#3b82f6", padding: "8px" }} />;', reextract: { source: "token", property: "font-size" } },
          { target: { property: "color" }, token: blue, ref: "var(--color-blue-500)", reextract: { source: "token", property: "color" } },
          { target: { property: "padding" }, token: space, ref: "var(--space-2)", output: 'const A = () => <div css={{ fontSize: 12, color: "#3b82f6", padding: "var(--space-2)" }} />;', reextract: { source: "token", property: "padding" } },
        ],
      },
      {
        file: "e.tsx",
        code: 'import styled from "@emotion/styled";\nconst B = styled.div`border-radius: 4px; color: #3b82f6;`;',
        expect: [],
        writes: [
          { target: { property: "border-radius" }, token: radius, ref: "var(--radius-sm)", reextract: { source: "token", property: "border-radius" } },
          { target: { property: "color" }, token: { ...blue, name: "color.brand" }, ref: null, reextract: {} },
        ],
      },
    ]);
    expect(report.failed).toEqual([]);
    expect(report.passed).toBe(2);
  });
});
