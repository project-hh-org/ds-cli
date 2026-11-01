import type { StyleUsage } from "@dsmith/extractor-api";
import { runConformance } from "@dsmith/extractor-api";
import { describe, expect, it } from "vitest";
import { cssExtractor } from "../src/index.js";

function extractAll(code: string, file = "a.css"): StyleUsage[] {
  return cssExtractor.extract({ root: "/", file, code });
}

function find(code: string, raw: string, file = "a.css"): StyleUsage {
  const usage = extractAll(code, file).find((u) => u.raw === raw);
  if (usage === undefined) throw new Error(`usage 없음: ${raw}`);
  return usage;
}

describe("cssExtractor meta", () => {
  it("name·files·parses를 선언한다", () => {
    expect(cssExtractor.name).toBe("css");
    expect(cssExtractor.files).toEqual(["**/*.{css,scss}"]);
    expect(cssExtractor.parses).toBe("none");
  });

  it(".module. 파일은 적용하지 않는다", () => {
    const ctx = (file: string) => ({ root: "/", file, code: "a{color:red}" });
    expect(cssExtractor.appliesTo(ctx("src/a.css"))).toBe(true);
    expect(cssExtractor.appliesTo(ctx("src/a.scss"))).toBe(true);
    expect(cssExtractor.appliesTo(ctx("src/a.module.css"))).toBe(false);
    expect(cssExtractor.appliesTo(ctx("src/a.module.scss"))).toBe(false);
    expect(cssExtractor.appliesTo(ctx("src/a.tsx"))).toBe(false);
  });
});

describe("cssExtractor conformance", () => {
  it("계약을 지킨다", () => {
    const report = runConformance("css", () => cssExtractor, [
      {
        file: "btn.css",
        code: ".btn{color:#3B82F6;padding:13px;background:var(--bg)}",
        expect: [
          {
            property: "color",
            raw: "#3B82F6",
            source: "hardcoded",
            extractor: "css",
            normalized: { kind: "color", hex: "#3b82f6" },
          },
          { property: "padding", raw: "13px", source: "hardcoded", normalized: { kind: "length", px: 13 } },
          { raw: "var(--bg)", source: "token", normalized: { kind: "unknown" } },
        ],
      },
    ]);
    expect(report.failed).toEqual([]);
    expect(report.passed).toBe(1);
  });
});

describe("cssExtractor.extract", () => {
  it("위치(line/column)는 값 시작을 가리킨다(줄 1부터, 열 0부터)", () => {
    const code = ".a {\n  color: #fff;\n  margin: 4px;\n}";
    const color = find(code, "#fff");
    expect([color.line, color.column]).toEqual([2, 9]);
    const margin = find(code, "4px");
    expect([margin.line, margin.column]).toEqual([3, 10]);
    expect(color.file).toBe("a.css");
  });

  it("var(--x)와 scss $변수는 token이고 속성은 유지한다", () => {
    const usages = extractAll("a{color:var(--c);padding:$space-2;width: VAR(--w)}");
    expect(usages.map((u) => [u.property, u.source, u.normalized.kind])).toEqual([
      ["color", "token", "unknown"],
      ["padding", "token", "unknown"],
      ["width", "token", "unknown"],
    ]);
  });

  it("색 속성에서 정규화할 수 없는 값은 hardcoded unknown", () => {
    const [usage] = extractAll("a{color:currentColor}");
    expect(usage).toMatchObject({ property: "color", source: "hardcoded", normalized: { kind: "unknown" } });
  });

  it("길이는 첫 공백 토큰만 정규화한다", () => {
    const usage = find("a{padding:13px 8px}", "13px");
    expect(usage).toMatchObject({ property: "padding", source: "hardcoded", normalized: { kind: "length", px: 13 } });
  });

  it("길이 단위를 환산하고 모르는 값은 unknown", () => {
    expect(find("a{gap:1.5rem}", "1.5rem").normalized).toEqual({ kind: "length", px: 24 });
    expect(find("a{width:50%}", "50%").normalized).toEqual({ kind: "unknown" });
    expect(find("a{height:calc(1px + 2px)}", "calc(1px + 2px)").normalized).toEqual({ kind: "unknown" });
  });

  it("케밥 속성명을 StyleProperty로 분류하고 모르는 속성은 other", () => {
    const usages = extractAll("a{background-color:#fff;border-radius:4px;font-size:14px;display:flex}");
    expect(usages.map((u) => u.property)).toEqual(["background-color", "border-radius", "font-size", "other"]);
    expect(usages[3]).toMatchObject({ source: "hardcoded", normalized: { kind: "unknown" } });
  });

  it("border 축약은 색 토큰만 border-color usage로 만든다", () => {
    const usage = find("a{border:1px solid #000}", "#000");
    expect(usage).toMatchObject({
      property: "border-color",
      source: "hardcoded",
      normalized: { kind: "color", hex: "#000000" },
    });
    expect(usage.column).toBe(19);
  });

  it("background 축약은 background-color로 승격한다", () => {
    expect(find("a{background:#fff url(x.png) no-repeat}", "#fff").property).toBe("background-color");
    expect(find("a{outline:2px solid red}", "red").property).toBe("border-color");
  });

  it("색이 없는 축약은 other hardcoded unknown", () => {
    const [usage] = extractAll("a{background:url(x.png)}");
    expect(usage).toMatchObject({ property: "other", raw: "url(x.png)", source: "hardcoded" });
    expect(usage?.normalized).toEqual({ kind: "unknown" });
  });

  it("축약의 var(--x) 전체 값은 token", () => {
    const [usage] = extractAll("a{background:var(--bg)}");
    expect(usage).toMatchObject({ source: "token", property: "other" });
  });

  it("!important는 값에서 제외한다", () => {
    const code = "a{color:#fff !important}";
    const usage = find(code, "#fff");
    expect(usage.normalized).toMatchObject({ kind: "color", hex: "#ffffff" });
    const patch = cssExtractor.write(usage, "var(--c)")!;
    expect(code.slice(patch.start, patch.end)).toBe("#fff");
  });

  it("중첩 블록·미디어 쿼리·주석을 처리한다", () => {
    const usages = extractAll(".a{ /* color:#000 */ &:hover{color:#111} @media (min-width:10px){padding:4px} }");
    expect(usages.map((u) => u.raw)).toEqual(["#111", "4px"]);
  });

  it("파일 오프셋 계산이 CRLF 줄바꿈에서도 맞는다", () => {
    const usage = find("a {\r\n  color: red;\r\n}", "red");
    expect([usage.line, usage.column]).toEqual([2, 9]);
  });

  it("빈 파일은 빈 배열", () => {
    expect(extractAll("")).toEqual([]);
  });
});

describe("cssExtractor 혼합 값", () => {
  it("var()와 하드코딩이 섞인 길이는 하드코딩 토큰을 보고한다", () => {
    const usage = find("a{margin: var(--x) 13px}", "13px");
    expect(usage).toMatchObject({ property: "margin", source: "hardcoded", normalized: { kind: "length", px: 13 } });
    const code = "a{margin: var(--x) 13px}";
    const patch = cssExtractor.write(usage, "var(--space-3)")!;
    expect(code.slice(0, patch.start) + patch.replacement + code.slice(patch.end)).toBe(
      "a{margin: var(--x) var(--space-3)}",
    );
  });

  it("var()와 하드코딩이 섞인 border 축약은 색을 보고한다", () => {
    const usage = find("a{border: var(--w) solid #000}", "#000");
    expect(usage).toMatchObject({ property: "border-color", source: "hardcoded" });
  });

  it("값 전체가 var()/$변수 토큰들뿐이면 token", () => {
    const usages = extractAll("a{margin: var(--a) var(--b); padding: $a $b; width: var(--w, 3px)}");
    expect(usages.map((u) => u.source)).toEqual(["token", "token", "token"]);
  });

  it("var()가 값의 일부일 뿐인 다른 속성은 token이 아니다", () => {
    const [usage] = extractAll("a{transition: opacity var(--d) ease}");
    expect(usage).toMatchObject({ property: "other", source: "hardcoded" });
  });
});

describe("cssExtractor scss", () => {
  it(".scss는 // 줄 주석을 무시한다", () => {
    const code = "a {\n  // padding: 99px (\n  padding: 1px; // note\n  margin: 2px;\n}";
    const usages = extractAll(code, "a.scss");
    expect(usages.map((u) => u.raw)).toEqual(["1px", "2px"]);
    expect(usages[1]).toMatchObject({ line: 4, column: 10 });
  });

  it(".css는 //를 주석으로 보지 않는다", () => {
    const usages = extractAll("a { background: url(//cdn/x.png); margin: 2px }", "a.css");
    expect(usages.map((u) => u.property)).toEqual(["other", "margin"]);
  });
});
