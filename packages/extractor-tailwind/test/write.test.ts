import type { StyleUsage, WritePatch } from "@dsmith/extractor-api";
import { describe, expect, it } from "vitest";
import { tailwindExtractor } from "../src/index.js";

function extractAll(code: string): StyleUsage[] {
  return tailwindExtractor.extract({ root: "/", file: "w.tsx", code });
}

function extractOne(code: string, raw: string): StyleUsage {
  const usage = extractAll(code).find((u) => u.raw === raw);
  if (usage === undefined) throw new Error(`usage 없음: ${raw}`);
  return usage;
}

function apply(code: string, patch: WritePatch): string {
  return code.slice(0, patch.start) + patch.replacement + code.slice(patch.end);
}

describe("tailwindExtractor.write", () => {
  it("클래스 토큰 하나만 치환하고 앞뒤 공백을 보존한다", () => {
    const code = `const x = <div className="flex  text-[#3B82F6]\n  p-4" />;`;
    const patch = tailwindExtractor.write(extractOne(code, "text-[#3B82F6]"), "text-primary-500")!;
    expect(code.slice(patch.start, patch.end)).toBe("text-[#3B82F6]");
    expect(patch.file).toBe("w.tsx");
    expect(apply(code, patch)).toBe(`const x = <div className="flex  text-primary-500\n  p-4" />;`);
  });

  it("variant 접두를 보존한다", () => {
    const code = `const x = <div className="md:text-[#3B82F6]" />;`;
    const patch = tailwindExtractor.write(extractOne(code, "md:text-[#3B82F6]"), "text-primary-500")!;
    expect(code.slice(patch.start, patch.end)).toBe("md:text-[#3B82F6]");
    expect(patch.replacement).toBe("md:text-primary-500");
    expect(apply(code, patch)).toBe(`const x = <div className="md:text-primary-500" />;`);
  });

  it("여러 variant를 순서대로 보존한다", () => {
    const code = `const x = <div className="md:hover:text-[#3B82F6]" />;`;
    const patch = tailwindExtractor.write(extractOne(code, "md:hover:text-[#3B82F6]"), "text-primary-500")!;
    expect(patch.replacement).toBe("md:hover:text-primary-500");
  });

  it("tailwind-default usage도 치환한다", () => {
    const code = `const x = <div className="text-blue-500 p-4" />;`;
    const patch = tailwindExtractor.write(extractOne(code, "text-blue-500"), "text-primary-500")!;
    expect(apply(code, patch)).toBe(`const x = <div className="text-primary-500 p-4" />;`);
  });

  it("템플릿 리터럴과 cn() 인자 안의 토큰도 치환한다", () => {
    const code = "const x = <div className={cn(`p-4 ${a ? \"bg-[#fff]\" : \"\"}`, \"m-[13px]\")} />;";
    const bg = tailwindExtractor.write(extractOne(code, "bg-[#fff]"), "bg-surface")!;
    const m = tailwindExtractor.write(extractOne(code, "m-[13px]"), "m-3")!;
    expect(code.slice(bg.start, bg.end)).toBe("bg-[#fff]");
    expect(code.slice(m.start, m.end)).toBe("m-[13px]");
    const p = tailwindExtractor.write(extractOne(code, "p-4"), "p-space-4")!;
    expect(code.slice(p.start, p.end)).toBe("p-4");
  });

  it("이스케이프가 있는 문자열에서도 정확한 구간을 가리킨다", () => {
    const code = `const x = <div className={cn("a\\nb p-[13px]")} />;`;
    const patch = tailwindExtractor.write(extractOne(code, "p-[13px]"), "p-3")!;
    expect(code.slice(patch.start, patch.end)).toBe("p-[13px]");
  });

  it("!가 붙은 토큰은 !를 보존한다", () => {
    const code = `const x = <div className="!bg-[#fff] md:!p-[13px] m-[13px]!" />;`;
    const bg = tailwindExtractor.write(extractOne(code, "!bg-[#fff]"), "bg-surface")!;
    expect(code.slice(bg.start, bg.end)).toBe("!bg-[#fff]");
    expect(bg.replacement).toBe("!bg-surface");
    const p = tailwindExtractor.write(extractOne(code, "md:!p-[13px]"), "p-3")!;
    expect(p.replacement).toBe("md:!p-3");
    const m = tailwindExtractor.write(extractOne(code, "m-[13px]!"), "m-3")!;
    expect(code.slice(m.start, m.end)).toBe("m-[13px]!");
    expect(m.replacement).toBe("m-3!");
    expect(apply(code, m)).toBe(`const x = <div className="!bg-[#fff] md:!p-[13px] m-3!" />;`);
  });

  it("음수 토큰은 전체를 치환하므로 부호는 tokenRef가 담는다", () => {
    const code = `const x = <div className="-mt-2 p-4" />;`;
    const patch = tailwindExtractor.write(extractOne(code, "-mt-2"), "-mt-space-1")!;
    expect(code.slice(patch.start, patch.end)).toBe("-mt-2");
    expect(patch.replacement).toBe("-mt-space-1");
    expect(apply(code, patch)).toBe(`const x = <div className="-mt-space-1 p-4" />;`);
  });

  it("dynamic usage에는 null을 돌려준다", () => {
    const code = `const x = <div className={cn("p-4", props.className)} />;`;
    const dynamic = extractAll(code).find((u) => u.source === "dynamic")!;
    expect(tailwindExtractor.write(dynamic, "x")).toBeNull();
  });

  it("token 소스 usage에는 null을 돌려준다", () => {
    const code = `const x = <div className="text-primary-500" />;`;
    expect(tailwindExtractor.write(extractOne(code, "text-primary-500"), "x")).toBeNull();
  });

  it("추출기가 만들지 않은 usage에는 null을 돌려준다", () => {
    const code = `const x = <div className="text-[#3B82F6]" />;`;
    const foreign = { ...extractOne(code, "text-[#3B82F6]") };
    expect(tailwindExtractor.write(foreign, "x")).toBeNull();
  });
});

describe("tailwindExtractor.write: 점수 대상이 아닌 usage", () => {
  it("other 속성(text-[foo])과 정규화 안 된 값(w-[calc(...)])은 null", () => {
    const code = `const x = <div className="text-[foo] w-[calc(100%-8px)] p-[13px]" />;`;
    const usages = extractAll(code);
    expect(usages.map((u) => [u.raw, tailwindExtractor.write(u, "x") === null])).toEqual([
      ["text-[foo]", true],
      ["w-[calc(100%-8px)]", true],
      ["p-[13px]", false],
    ]);
  });
});
