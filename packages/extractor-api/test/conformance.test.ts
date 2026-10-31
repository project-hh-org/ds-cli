import { describe, expect, it } from "vitest";
import { runConformance } from "../src/conformance.js";
import type { ConformanceCase } from "../src/conformance.js";
import type { Extractor, StyleUsage } from "../src/extractor.js";

const usage = (over: Partial<StyleUsage> = {}): StyleUsage => ({
  file: "a.tsx",
  line: 1,
  column: 10,
  property: "color",
  raw: "#ff0000",
  normalized: { kind: "color", hex: "#ff0000", l: 0.628, c: 0.258, h: 29.2 },
  source: "hardcoded",
  extractor: "dummy",
  ...over,
});

const makeExtractor = (extract: Extractor["extract"]): Extractor => ({
  name: "dummy",
  appliesTo: () => true,
  extract,
  write: () => null,
});

describe("runConformance", () => {
  it("extract가 expect를 그대로 반환하면 모든 케이스가 통과한다", () => {
    const expected = [usage()];
    const cases: ConformanceCase[] = [
      { code: "x", file: "a.tsx", expect: expected },
      { code: "y", file: "b.tsx", expect: [] },
    ];
    const report = runConformance("dummy", () => makeExtractor(() => expected), cases);
    expect(report).toEqual({ passed: 2, failed: [] });
  });

  it("빈 배열을 반환하면 expect가 비어있지 않은 케이스는 실패한다", () => {
    const cases: ConformanceCase[] = [
      { code: "x", file: "a.tsx", expect: [usage()] },
      { code: "y", file: "b.tsx", expect: [] },
    ];
    const report = runConformance("dummy", () => makeExtractor(() => []), cases);
    expect(report.passed).toBe(1);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]?.case).toBe(0);
    expect(report.failed[0]?.reason).toMatch(/nothing|아무것도|비어/);
  });

  it("partial 일부 필드만 지정하면 그 필드만 비교한다 (line/column 생략 가능)", () => {
    const cases: ConformanceCase[] = [
      { code: "x", file: "a.tsx", expect: [{ property: "color", raw: "#ff0000" }] },
    ];
    const report = runConformance("dummy", () => makeExtractor(() => [usage({ line: 7, column: 3 })]), cases);
    expect(report.failed).toEqual([]);
  });

  it("expect에 line/column이 있으면 비교하고 다르면 실패한다", () => {
    const cases: ConformanceCase[] = [
      { code: "x", file: "a.tsx", expect: [{ line: 2 }] },
      { code: "x", file: "a.tsx", expect: [{ column: 99 }] },
      { code: "x", file: "a.tsx", expect: [{ line: 1, column: 10 }] },
    ];
    const report = runConformance("dummy", () => makeExtractor(() => [usage()]), cases);
    expect(report.passed).toBe(1);
    expect(report.failed.map((f) => f.case)).toEqual([0, 1]);
  });

  it("normalized 같은 중첩 객체도 deep partial로 비교한다", () => {
    const cases: ConformanceCase[] = [
      { code: "x", file: "a.tsx", expect: [{ normalized: { kind: "color", hex: "#ff0000" } as StyleUsage["normalized"] }] },
      { code: "x", file: "a.tsx", expect: [{ normalized: { kind: "length", px: 4 } }] },
    ];
    const report = runConformance("dummy", () => makeExtractor(() => [usage()]), cases);
    expect(report.passed).toBe(1);
    expect(report.failed.map((f) => f.case)).toEqual([1]);
  });

  it("expect의 각 partial은 서로 다른 usage일 필요 없이 하나 이상의 usage와 매칭되면 된다", () => {
    const cases: ConformanceCase[] = [
      {
        code: "x",
        file: "a.tsx",
        expect: [{ property: "color" }, { property: "padding" }],
      },
    ];
    const report = runConformance(
      "dummy",
      () => makeExtractor(() => [usage(), usage({ property: "padding" })]),
      cases,
    );
    expect(report.failed).toEqual([]);
  });

  it("extract에 root '/', 케이스의 file/code를 전달하고 매 케이스마다 새 인스턴스를 만든다", () => {
    const seen: { root: string; file: string; code: string }[] = [];
    let made = 0;
    const cases: ConformanceCase[] = [
      { code: "c1", file: "f1.tsx", expect: [] },
      { code: "c2", file: "f2.tsx", expect: [] },
    ];
    runConformance(
      "dummy",
      () => {
        made++;
        return makeExtractor((ctx) => {
          seen.push(ctx);
          return [];
        });
      },
      cases,
    );
    expect(made).toBe(2);
    expect(seen).toEqual([
      { root: "/", file: "f1.tsx", code: "c1" },
      { root: "/", file: "f2.tsx", code: "c2" },
    ]);
  });

  it("extract가 throw하면 해당 케이스만 실패로 기록한다", () => {
    const cases: ConformanceCase[] = [{ code: "x", file: "a.tsx", expect: [] }];
    const report = runConformance(
      "dummy",
      () =>
        makeExtractor(() => {
          throw new Error("boom");
        }),
      cases,
    );
    expect(report.passed).toBe(0);
    expect(report.failed[0]?.reason).toContain("boom");
  });
});
