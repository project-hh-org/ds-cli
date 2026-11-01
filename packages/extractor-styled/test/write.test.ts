import type { StyleUsage, WritePatch } from "@dsmith/extractor-api";
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

  it("객체 문법 값은 문자열 리터럴로 치환한다", () => {
    const code = `${SC}const B = styled.div({ color: "#fff", padding: 12 });`;
    const color = styledExtractor.write(find(code, "#fff"), "var(--c)")!;
    expect(apply(code, color)).toBe(`${SC}const B = styled.div({ color: "var(--c)", padding: 12 });`);
    const padding = styledExtractor.write(find(code, "12"), "var(--s)")!;
    expect(apply(code, padding)).toBe(`${SC}const B = styled.div({ color: "#fff", padding: "var(--s)" });`);
  });

  it("dynamic·token usage와 남이 만든 usage는 null", () => {
    const code = `${SC}const B = styled.div\`color: \${c}; margin: var(--m);\`;`;
    const usages = styledExtractor.extract({ root: "/", file: "a.tsx", code });
    expect(usages.map((u) => styledExtractor.write(u, "x"))).toEqual([null, null]);
    const foreign: StyleUsage = { ...usages[0]!, source: "hardcoded" };
    expect(styledExtractor.write(foreign, "x")).toBeNull();
  });
});
