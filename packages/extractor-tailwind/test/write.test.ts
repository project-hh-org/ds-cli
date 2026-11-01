import { runConformance } from "@dsmith-dev/extractor-api";
import type { StyleUsage, WritePatch } from "@dsmith-dev/extractor-api";
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

describe("tailwindExtractor.tokenRef + conformance write 왕복", () => {
  const blue = { name: "--color-blue-500", value: "#3b82f6", category: "color" as const, normalized: { kind: "color" as const, hex: "#3b82f6", l: 0.62, c: 0.2, h: 260 } };
  const space = { name: "--space-2", value: "8px", category: "spacing" as const, normalized: { kind: "length" as const, px: 8 } };
  const radius = { name: "--radius-sm", value: "4px", category: "radius" as const, normalized: { kind: "length" as const, px: 4 } };
  const text = { name: "--text-xs", value: "12px", category: "font-size" as const, normalized: { kind: "length" as const, px: 12 } };
  const preset = {
    version: 3 as const,
    file: "design-system/tailwind.preset.ts",
    linked: true,
    keys: { "--color-blue-500": "ds-blue-500", "--space-2": "ds-2", "--radius-sm": "ds-sm", "--text-xs": "ds-xs" },
  };
  const JSXC = (cls: string) => `const x = <div className="${cls}" />;`;
  const CLS = "bg-[#3b82f6] md:p-[8px] -mt-[8px] text-[13px] rounded-[4px] !border-[#fff]";

  it("프리셋 없음: 타입 힌트가 붙은 임의값, variant·부호·!는 보존", () => {
    const report = runConformance("tailwind", () => tailwindExtractor, [
      {
        file: "w.tsx",
        code: JSXC(CLS),
        expect: [],
        writes: [
          { target: { raw: "bg-[#3b82f6]" }, token: blue, ref: "bg-[color:var(--color-blue-500)]", output: JSXC(CLS.replace("bg-[#3b82f6]", "bg-[color:var(--color-blue-500)]")), reextract: { source: "token", property: "background-color" } },
          { target: { raw: "md:p-[8px]" }, token: space, ref: "p-[var(--space-2)]", output: JSXC(CLS.replace("md:p-[8px]", "md:p-[var(--space-2)]")), reextract: { source: "token", property: "padding" } },
          { target: { raw: "-mt-[8px]" }, token: space, ref: "-mt-[var(--space-2)]", output: JSXC(CLS.replace("-mt-[8px]", "-mt-[var(--space-2)]")), reextract: { source: "token", property: "margin" } },
          { target: { raw: "text-[13px]" }, token: text, ref: "text-[length:var(--text-xs)]", output: JSXC(CLS.replace("text-[13px]", "text-[length:var(--text-xs)]")), reextract: { source: "token", property: "font-size" } },
          { target: { raw: "rounded-[4px]" }, token: radius, ref: "rounded-[var(--radius-sm)]", reextract: { source: "token", property: "border-radius" } },
          { target: { raw: "!border-[#fff]" }, token: blue, ref: "border-[color:var(--color-blue-500)]", output: JSXC(CLS.replace("!border-[#fff]", "!border-[color:var(--color-blue-500)]")), reextract: { source: "token", property: "border-color" } },
        ],
      },
    ]);
    expect(report.failed).toEqual([]);
  });

  it("프리셋 연결: ds- 접두 클래스명, 재추출하면 token(글꼴 크기는 font-size)", () => {
    const ctx = { preset };
    const report = runConformance("tailwind", () => tailwindExtractor, [
      {
        file: "w.tsx",
        code: JSXC(CLS),
        expect: [],
        writes: [
          { target: { raw: "bg-[#3b82f6]" }, token: blue, ctx, ref: "bg-ds-blue-500", output: JSXC(CLS.replace("bg-[#3b82f6]", "bg-ds-blue-500")), reextract: { source: "token", property: "background-color" } },
          { target: { raw: "md:p-[8px]" }, token: space, ctx, ref: "p-ds-2", output: JSXC(CLS.replace("md:p-[8px]", "md:p-ds-2")), reextract: { source: "token", property: "padding" } },
          { target: { raw: "-mt-[8px]" }, token: space, ctx, ref: "-mt-ds-2", reextract: { source: "token", property: "margin" } },
          { target: { raw: "text-[13px]" }, token: text, ctx, ref: "text-ds-xs", output: JSXC(CLS.replace("text-[13px]", "text-ds-xs")), reextract: { source: "token", property: "font-size" } },
          { target: { raw: "rounded-[4px]" }, token: radius, ctx, ref: "rounded-ds-sm", reextract: { source: "token", property: "border-radius" } },
          { target: { raw: "!border-[#fff]" }, token: blue, ctx, ref: "border-ds-blue-500", output: JSXC(CLS.replace("!border-[#fff]", "!border-ds-blue-500")), reextract: { source: "token", property: "border-color" } },
        ],
      },
    ]);
    expect(report.failed).toEqual([]);
  });

  it("tailwind-default 색(bg-blue-500)도 프리셋 클래스로 바뀐다", () => {
    const report = runConformance("tailwind", () => tailwindExtractor, [
      {
        file: "w.tsx",
        code: JSXC("bg-blue-500 p-2"),
        expect: [],
        writes: [{ target: { raw: "bg-blue-500" }, token: blue, ctx: { preset }, ref: "bg-ds-blue-500", output: JSXC("bg-ds-blue-500 p-2"), reextract: { source: "token", property: "background-color" } }],
      },
    ]);
    expect(report.failed).toEqual([]);
  });

  it("CSS 변수가 아닌 토큰·토큰 대상이 아닌 속성은 null", () => {
    const code = JSXC("bg-[#3b82f6] w-[8px]");
    const bg = extractOne(code, "bg-[#3b82f6]");
    const w = extractOne(code, "w-[8px]");
    expect(tailwindExtractor.tokenRef!({ ...blue, name: "color.brand" }, bg, {})).toBeNull();
    expect(tailwindExtractor.tokenRef!(space, w, {})).toBeNull();
    expect(tailwindExtractor.tokenRef!(space, bg, {})).toBeNull();
  });

  it("text-ds-* 프리셋 글꼴 크기 키만 font-size로 읽고 나머지 text-ds-*는 색 token", () => {
    const usages = extractAll(JSXC("text-ds-xs text-ds-2xl text-ds-blue-500 text-xs"));
    expect(usages.map((u) => [u.raw, u.property, u.source])).toEqual([
      ["text-ds-xs", "font-size", "token"],
      ["text-ds-2xl", "font-size", "token"],
      ["text-ds-blue-500", "color", "token"],
      ["text-xs", "font-size", "tailwind-default"],
    ]);
  });
});

describe("tailwindExtractor 프리셋 글꼴 크기 키 범위", () => {
  const mk = (name: string) => ({ name, value: "10px", category: "font-size" as const, normalized: { kind: "length" as const, px: 10 } });
  const code = `const x = <div className="text-[10px]" />;`;
  const target = { raw: "text-[10px]" };

  it("2xs 키(ds-2xs)는 text-ds-2xs로 쓰고 font-size token으로 재추출된다", () => {
    const ctx = { preset: { version: 3 as const, file: "p.ts", linked: true, keys: { "--text-2xs": "ds-2xs" } } };
    const report = runConformance("tailwind", () => tailwindExtractor, [
      { file: "w.tsx", code, expect: [], writes: [{ target, token: mk("--text-2xs"), ctx, ref: "text-ds-2xs", output: `const x = <div className="text-ds-2xs" />;`, reextract: { source: "token", property: "font-size" } }] },
    ]);
    expect(report.failed).toEqual([]);
  });

  it("프리셋 글꼴 크기 키 모양이 아니면 text-[length:var()]로 되돌린다(색으로 오인되지 않게)", () => {
    const ctx = { preset: { version: 3 as const, file: "p.ts", linked: true, keys: { "--text-x": "ds-huge" } } };
    const report = runConformance("tailwind", () => tailwindExtractor, [
      { file: "w.tsx", code, expect: [], writes: [{ target, token: mk("--text-x"), ctx, ref: "text-[length:var(--text-x)]", reextract: { source: "token", property: "font-size" } }] },
    ]);
    expect(report.failed).toEqual([]);
  });
});
