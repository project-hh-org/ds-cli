import { describe, expect, it } from "vitest";
import { metas, registry } from "../src/registry.js";

const NAMES = ["inline-style", "tailwind", "css", "styled", "emotion", "mui-sx"];

describe("registry", () => {
  it("metas()는 6종을 등록 순서대로 돌려준다", () => {
    expect(metas().map((m) => m.name)).toEqual(NAMES);
  });

  it("레지스트리 키와 각 팩토리가 만든 Extractor.name이 같다", () => {
    for (const [key, factory] of Object.entries(registry)) {
      expect(factory().name).toBe(key);
    }
  });
});
