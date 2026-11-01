import { describe, expect, it } from "vitest";
import { metas, registry } from "../src/registry.js";

const NAMES = ["inline-style", "tailwind", "css", "styled", "emotion", "mui-sx"];

describe("registry", () => {
  it("metas()는 6종을 등록 순서대로 돌려준다", () => {
    expect(metas().map((m) => m.name)).toEqual(NAMES);
  });

  it("6종 모두 detect용 signals를 선언하고 metas()가 그대로 넘긴다", () => {
    for (const m of metas()) {
      expect(m.signals, m.name).toBeDefined();
      expect(m.signals).toEqual(registry[m.name]!().signals);
    }
  });

  it("레지스트리 키와 각 팩토리가 만든 Extractor.name이 같다", () => {
    for (const [key, factory] of Object.entries(registry)) {
      expect(factory().name).toBe(key);
    }
  });
});

describe("registry ↔ eslint-plugin", () => {
  it("ESLint 플러그인의 내장 Extractor 표와 키 목록이 같다", async () => {
    // 플러그인은 cli를 모르므로 의존 없이 소스를 직접 불러 비교한다(cli가 플러그인에 의존하지 않는다)
    const { BUILTIN_EXTRACTORS } = await import("../../eslint-plugin/src/registry.js");
    expect(Object.keys(registry).sort()).toEqual(["css", "emotion", "inline-style", "mui-sx", "styled", "tailwind"]);
    expect(Object.keys(BUILTIN_EXTRACTORS).sort()).toEqual(Object.keys(registry).sort());
    for (const [key, factory] of Object.entries(registry)) expect(BUILTIN_EXTRACTORS[key], key).toBe(factory());
  });
});
