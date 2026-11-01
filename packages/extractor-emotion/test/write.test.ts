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
