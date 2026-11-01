import type { Extractor, StyleUsage } from "@dsmith-dev/extractor-api";
import { describe, expect, it } from "vitest";
import { extractFileStyles, extractorMatchers } from "../src/index/extract-file.js";

const usage = (file: string): StyleUsage => ({
  file,
  line: 1,
  column: 1,
  property: "color",
  raw: "#fff",
  normalized: { kind: "unknown" },
  source: "hardcoded",
  extractor: "fake",
});

function fake(name: string, files: string[], opts: { applies?: boolean; throws?: boolean } = {}): Extractor {
  return {
    name,
    files,
    parses: "none",
    appliesTo: () => opts.applies ?? true,
    extract: () => {
      if (opts.throws) throw new Error("boom");
      return [usage("elsewhere")];
    },
    write: () => null,
  };
}

describe("extractorMatchers", () => {
  it("dot 기본 false: 점 디렉터리는 안 맞고, dot:true면 맞는다", () => {
    const e = [fake("a", ["**/*.tsx"])];
    expect(extractorMatchers(e)[0]?.matches("src/.hidden/x.tsx")).toBe(false);
    expect(extractorMatchers(e, { dot: true })[0]?.matches("src/.hidden/x.tsx")).toBe(true);
    expect(extractorMatchers(e)[0]?.matches("x.tsx")).toBe(true);
  });
});

describe("extractFileStyles", () => {
  const ctx = { root: "/r", file: "src/x.tsx", code: "" };

  it("glob이 맞고 appliesTo가 참인 Extractor만 실행하고 usage.file을 맞춘다", () => {
    const matchers = extractorMatchers([
      fake("a", ["**/*.tsx"]),
      fake("b", ["**/*.css"]),
      fake("c", ["**/*.tsx"], { applies: false }),
    ]);
    const out = extractFileStyles(ctx, matchers);
    expect(out.extractorsRun).toEqual(["a"]);
    expect(out.styles).toHaveLength(1);
    expect(out.styles[0]?.file).toBe("src/x.tsx");
  });

  it("Extractor 예외는 parse(<name>): <msg>로 다시 던진다", () => {
    const matchers = extractorMatchers([fake("a", ["**/*.tsx"]), fake("bad", ["**/*.tsx"], { throws: true })]);
    expect(() => extractFileStyles(ctx, matchers)).toThrow("parse(bad): boom");
  });
});
