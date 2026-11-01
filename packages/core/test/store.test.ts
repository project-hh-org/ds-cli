import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readIndex, writeIndex } from "../src/index/store.js";
import type { Index } from "../src/index/indexer.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const sample: Index = {
  root: "/repo",
  createdAt: "2026-11-01T00:00:00.000Z",
  extractors: ["inline-style"],
  files: { scanned: 1, skipped: [{ file: "bad.tsx", reason: "parse: boom" }] },
  styles: [
    {
      file: "a.tsx",
      line: 1,
      column: 2,
      property: "color",
      raw: "#fff",
      normalized: { kind: "unknown" },
      source: "hardcoded",
      extractor: "inline-style",
    },
  ],
  components: [{ file: "a.tsx", line: 3, name: "Button", importedFrom: null, module: "", props: ["size"] }],
};

describe("index store", () => {
  it("writeIndex 후 readIndex가 동일한 객체를 돌려주고 쓴 경로를 반환한다", async () => {
    const written = await writeIndex(tmp, sample);
    expect(written).toBe(path.join(tmp, ".dsmith", "index.json"));
    expect(fs.readFileSync(written, "utf-8")).toContain('\n  "root"');
    expect(await readIndex(tmp)).toEqual(sample);
  });

  it("module 필드가 없는 이전 index.json은 importedFrom(없으면 빈 문자열)으로 module을 채워 읽는다", async () => {
    const old = {
      ...sample,
      components: [
        { file: "a.tsx", line: 3, name: "Button", importedFrom: null, props: [] },
        { file: "a.tsx", line: 4, name: "Card", importedFrom: "@acme/ui/card", props: [] },
      ],
    };
    fs.mkdirSync(path.join(tmp, ".dsmith"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".dsmith", "index.json"), JSON.stringify(old));
    const loaded = await readIndex(tmp);
    expect(loaded?.components.map((c) => c.module)).toEqual(["", "@acme/ui/card"]);
  });

  it("index.json이 없으면 null을 돌려준다", async () => {
    expect(await readIndex(tmp)).toBeNull();
    expect(await readIndex(path.join(tmp, "missing"))).toBeNull();
  });
});
