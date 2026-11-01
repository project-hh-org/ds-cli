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

  it("문자열 리터럴 패치는 따옴표 안 값 구간을 tokenRef 그대로 치환한다", () => {
    const patch = inlineStyleExtractor.write(extractOne(code, "color"), "var(--color-primary-500)");
    expect(patch).not.toBeNull();
    expect(code.slice(patch!.start, patch!.end)).toBe("#3B82F6");
    expect(patch!.replacement).toBe("var(--color-primary-500)");
    expect(patch!.file).toBe("w.tsx");
  });

  it("축약 값은 색 토큰 구간만 치환한다", () => {
    const src = `const x = <div style={{ border: "1px solid #ef4444" }} />;`;
    const usage = inlineStyleExtractor.extract({ root: "/", file: "b.tsx", code: src })[0]!;
    expect(usage).toMatchObject({ property: "border-color", raw: "#ef4444" });
    const patch = inlineStyleExtractor.write(usage, "var(--danger)")!;
    expect(src.slice(0, patch.start) + patch.replacement + src.slice(patch.end)).toBe(
      `const x = <div style={{ border: "1px solid var(--danger)" }} />;`,
    );
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

  it("음수 리터럴은 단항식 전체 구간을 치환한다", () => {
    const neg = `const x = <div style={{ margin: -4 }} />;`;
    const usage = inlineStyleExtractor.extract({ root: "/", file: "n.tsx", code: neg })[0]!;
    const patch = inlineStyleExtractor.write(usage, "var(--space-neg)")!;
    expect(neg.slice(patch.start, patch.end)).toBe("-4");
    expect(patch.replacement).toBe(`"var(--space-neg)"`);
  });

  it("dynamic usage에는 null을 돌려준다", () => {
    expect(inlineStyleExtractor.write(extractOne(code, "margin"), "var(--m)")).toBeNull();
  });

  it("추출기가 만들지 않은 usage에는 null을 돌려준다", () => {
    const foreign = { ...extractOne(code, "color") };
    expect(inlineStyleExtractor.write(foreign, "var(--c)")).toBeNull();
  });
});

describe("inlineStyleExtractor.write: 점수 대상이 아닌 usage", () => {
  it("other 속성(content·fontFamily·boxShadow·opacity 숫자)과 정규화 안 된 값은 null", () => {
    const code = `const x = <div style={{ content: "가😀", fontFamily: "Inter", boxShadow: "0 1px 2px #000", opacity: 0.5, width: "calc(100% - 8px)", padding: "13px 8px" }} />;`;
    const usages = inlineStyleExtractor.extract({ root: "/", file: "w.tsx", code });
    expect(usages.map((u) => [u.property, inlineStyleExtractor.write(u, "var(--x)") === null])).toEqual([
      ["other", true],
      ["other", true],
      ["other", true],
      ["other", true],
      ["width", true],
      ["padding", false],
    ]);
  });
});
