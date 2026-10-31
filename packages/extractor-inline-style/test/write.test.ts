import { describe, expect, it } from "vitest";
import { inlineStyleExtractor } from "../src/index.js";

function extractOne(code: string, property: string) {
  const usages = inlineStyleExtractor.extract({ root: "/", file: "w.tsx", code });
  const usage = usages.find((u) => u.property === property);
  if (usage === undefined) throw new Error(`usage 없음: ${property}`);
  return usage;
}

describe("inlineStyleExtractor.write", () => {
  const code = `const x = <div style={{ color: "#3B82F6", padding: 12, margin: theme.m }} />;`;

  it("문자열 리터럴 패치는 따옴표를 포함한 원본 구간을 가리킨다", () => {
    const patch = inlineStyleExtractor.write(extractOne(code, "color"), "var(--color-primary-500)");
    expect(patch).not.toBeNull();
    expect(code.slice(patch!.start, patch!.end)).toBe(`"#3B82F6"`);
    expect(patch!.replacement).toBe(`"var(--color-primary-500)"`);
    expect(patch!.file).toBe("w.tsx");
  });

  it("숫자 리터럴도 치환 패치를 만든다", () => {
    const patch = inlineStyleExtractor.write(extractOne(code, "padding"), "var(--space-3)");
    expect(code.slice(patch!.start, patch!.end)).toBe("12");
    expect(patch!.replacement).toBe(`"var(--space-3)"`);
  });

  it("패치를 적용하면 유효한 코드가 된다", () => {
    const patch = inlineStyleExtractor.write(extractOne(code, "color"), "var(--c)")!;
    const out = code.slice(0, patch.start) + patch.replacement + code.slice(patch.end);
    expect(out).toBe(`const x = <div style={{ color: "var(--c)", padding: 12, margin: theme.m }} />;`);
  });

  it("dynamic usage에는 null을 돌려준다", () => {
    expect(inlineStyleExtractor.write(extractOne(code, "margin"), "var(--m)")).toBeNull();
  });

  it("추출기가 만들지 않은 usage에는 null을 돌려준다", () => {
    const foreign = { ...extractOne(code, "color") };
    expect(inlineStyleExtractor.write(foreign, "var(--c)")).toBeNull();
  });
});
