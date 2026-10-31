import { describe, expect, it } from "vitest";
import { normalizeLength } from "../src/normalize/length.js";

describe("normalizeLength", () => {
  it.each([
    ["12px", 12],
    ["1.5rem", 24],
    ["2em", 32],
    ["0", 0],
    ["12", 12],
    [" 8px ", 8],
  ])("%j는 %d이다", (raw, expected) => {
    expect(normalizeLength(raw)).toBe(expected);
  });

  it.each(["auto", "50%", "100vh", "calc(1px + 2px)", ""])("%j는 null이다", (raw) => {
    expect(normalizeLength(raw)).toBeNull();
  });
});
