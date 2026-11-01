import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import plugin from "../src/index.js";

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(path.join(dir, e.name)) : e.name.endsWith(".ts") ? [path.join(dir, e.name)] : []));
}

describe("동기", () => {
  it("src/**/*.ts에 async·await·Promise·fs/promises가 없다", () => {
    const files = sources(path.resolve(import.meta.dirname, "../src"));
    expect(files.length).toBeGreaterThanOrEqual(7);
    for (const f of files) {
      const text = fs.readFileSync(f, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(text, f).not.toMatch(/\basync\b|\bawait\b|\bPromise\b|fs\/promises/);
    }
  });

  it("규칙 create의 반환은 thenable이 아니다", () => {
    const context = { options: [], sourceCode: { getText: () => "" }, report: () => undefined } as never;
    for (const [name, rule] of Object.entries(plugin.rules)) {
      const visitor = rule.create(context) as unknown as Record<string, unknown>;
      expect(typeof visitor["then"], name).not.toBe("function");
      expect(typeof visitor["Program"] === "function" || typeof visitor["Program:exit"] === "function", name).toBe(true);
    }
  });
});
