import { describe, expect, it } from "vitest";
import { normalizeOutDir } from "../src/out-dir.js";

const root = "/tmp/repo";

describe("normalizeOutDir", () => {
  it("기본값과 정규화", () => {
    expect(normalizeOutDir(root, undefined)).toBe("design-system");
    expect(normalizeOutDir(root, "./src/ds/")).toBe("src/ds");
    expect(normalizeOutDir(root, "src\\ds")).toBe("src/ds");
  });

  it.each(["../x", "a/../../x", ".dsmith", "a/.dsmith/b", "node_modules/x", "/abs/path", "C:\\abs", "", ".", "./"])(
    "거부: %s",
    (out) => {
      expect(() => normalizeOutDir(root, out)).toThrow(/--out/);
    },
  );
});
