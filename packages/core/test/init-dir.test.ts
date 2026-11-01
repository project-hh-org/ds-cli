import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findInitDir, readInitHashes } from "../src/fs/init-dir.js";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-initdir-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function put(rel: string, text: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}
const manifest = (m: object): void => put(".dsmith/init.json", JSON.stringify(m));

describe("findInitDir", () => {
  it("1. 매니페스트 outDir이 우선 — tokens.json이 있을 때", async () => {
    put("src/ds/tokens.json", "{}");
    put("design-system/tokens.json", "{}");
    manifest({ outDir: "src/ds", entries: { "design-system/tokens.json": {} } });
    expect(await findInitDir(root)).toBe("src/ds");
  });

  it("2. outDir의 tokens.json이 없으면 엔트리 키(이름순 첫째), #가 든 키는 건너뜀", async () => {
    manifest({ outDir: "gone", entries: { "z/tokens.json": {}, "a/tokens.json": {}, "x/tokens.css#region": {} } });
    expect(await findInitDir(root)).toBe("a");
    manifest({ entries: { "tokens.json": {} } });
    expect(await findInitDir(root)).toBe(".");
  });

  it("3. 매니페스트가 없거나 깨졌어도 design-system/tokens.json이 있으면 design-system", async () => {
    put("design-system/tokens.json", "{}");
    expect(await findInitDir(root)).toBe("design-system");
    put(".dsmith/init.json", "{깨짐");
    expect(await findInitDir(root)).toBe("design-system");
  });

  it("4. 아무것도 없으면 null", async () => {
    expect(await findInitDir(root)).toBeNull();
  });
});

describe("readInitHashes", () => {
  it("엔트리의 sha256을 맵으로, 없거나 깨졌으면 빈 맵", async () => {
    expect((await readInitHashes(root)).size).toBe(0);
    manifest({ entries: { "a.css": { sha256: "abc" }, "b.css": null, "c.css": { sha256: 1 } } });
    expect([...(await readInitHashes(root))]).toEqual([["a.css", "abc"]]);
    put(".dsmith/init.json", "x");
    expect((await readInitHashes(root)).size).toBe(0);
  });
});
