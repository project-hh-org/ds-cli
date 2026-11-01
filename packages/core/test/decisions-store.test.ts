import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Index } from "../src/index/indexer.js";
import type { ComponentUsage } from "../src/model/component-usage.js";
import { decisionCandidates, listDecisions } from "../src/decisions/candidates.js";
import type { DecisionRecord, DecisionsFile } from "../src/decisions/model.js";
import { readDecisions, recordDecision, writeDecisions } from "../src/decisions/store.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-decisions-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const record = (p: Partial<DecisionRecord> = {}): DecisionRecord => ({
  item: "Button",
  kind: "duplicate",
  status: "pending",
  options: ["a", "b"],
  ...p,
});

describe("readDecisions / writeDecisions", () => {
  it("파일이 없으면 빈 파일을 돌려준다", async () => {
    expect(await readDecisions(tmp)).toEqual({ version: 1, items: [] });
  });

  it("2칸 들여쓰기 + 개행으로 쓰고 같은 값으로 읽힌다", async () => {
    const file: DecisionsFile = { version: 1, items: [record()] };
    const written = await writeDecisions(tmp, file);
    expect(written).toBe(path.join(tmp, ".dsmith", "decisions.json"));
    const text = fs.readFileSync(written, "utf-8");
    expect(text).toBe(`${JSON.stringify(file, null, 2)}\n`);
    expect(await readDecisions(tmp)).toEqual(file);
  });

  it("깨진 JSON이면 파일명을 담은 에러를 던진다", async () => {
    fs.mkdirSync(path.join(tmp, ".dsmith"));
    fs.writeFileSync(path.join(tmp, ".dsmith", "decisions.json"), "{ not json");
    await expect(readDecisions(tmp)).rejects.toThrow(".dsmith/decisions.json");
  });

  it("모양이 틀려도 파일명을 담은 에러를 던진다", async () => {
    fs.mkdirSync(path.join(tmp, ".dsmith"));
    fs.writeFileSync(path.join(tmp, ".dsmith", "decisions.json"), JSON.stringify({ version: 2, items: [] }));
    await expect(readDecisions(tmp)).rejects.toThrow(".dsmith/decisions.json");
  });
});

describe("readDecisions 기록 검증", () => {
  const put = (items: unknown[]): void => {
    fs.mkdirSync(path.join(tmp, ".dsmith"), { recursive: true });
    fs.writeFileSync(path.join(tmp, ".dsmith", "decisions.json"), JSON.stringify({ version: 1, items }));
  };
  const ok = { item: "Button", kind: "duplicate", status: "pending", options: ["a"] };

  it("올바른 기록은 그대로 읽힌다", async () => {
    put([ok, { ...ok, kind: "token-cluster", status: "decided", chosen: "a", note: "n", decidedAt: "t" }]);
    expect((await readDecisions(tmp)).items).toHaveLength(2);
  });

  it.each([
    ["item이 문자열이 아님", { ...ok, item: 3 }],
    ["kind가 열거값이 아님", { ...ok, kind: "other" }],
    ["status가 열거값이 아님", { ...ok, status: "done" }],
    ["options가 문자열 배열이 아님", { ...ok, options: [1] }],
    ["chosen이 문자열이 아님", { ...ok, chosen: 1 }],
    ["객체가 아님", "x"],
  ])("%s → 파일명과 items 인덱스를 담은 에러", async (_label, bad) => {
    put([ok, bad]);
    await expect(readDecisions(tmp)).rejects.toThrow(/\.dsmith\/decisions\.json.*items\[1\]/);
  });
});

describe("writeDecisions 원자성", () => {
  it("임시 파일을 남기지 않고, 쓰는 동안 읽어도 항상 온전한 JSON이다", async () => {
    const big = (tag: string): DecisionsFile => ({
      version: 1,
      items: Array.from({ length: 3000 }, (_, i) => record({ item: `${tag}-${i}`, options: ["a".repeat(50), "b".repeat(50)] })),
    });
    await writeDecisions(tmp, big("x"));
    const target = path.join(tmp, ".dsmith", "decisions.json");
    let writing = true;
    let torn = 0;
    let reads = 0;
    const reader = (async () => {
      while (writing) {
        try {
          JSON.parse(fs.readFileSync(target, "utf-8"));
        } catch {
          torn++;
        }
        reads++;
        await new Promise((r) => setImmediate(r));
      }
    })();
    for (let i = 0; i < 25; i++) await writeDecisions(tmp, big(i % 2 === 0 ? "y" : "z"));
    writing = false;
    await reader;
    expect(reads).toBeGreaterThan(0);
    expect(torn).toBe(0);
    expect(fs.readdirSync(path.join(tmp, ".dsmith"))).toEqual(["decisions.json"]);
  });
});

describe("recordDecision", () => {
  it("(item, kind) 기준으로 upsert한다 — 두 번 기록해도 1건", () => {
    const empty: DecisionsFile = { version: 1, items: [] };
    const once = recordDecision(empty, record());
    const twice = recordDecision(once, record({ status: "decided", chosen: "a", decidedAt: "2026-11-01T00:00:00.000Z" }));
    expect(twice.items).toHaveLength(1);
    expect(twice.items[0]).toMatchObject({ status: "decided", chosen: "a" });
    // 순수: 입력을 바꾸지 않는다
    expect(empty.items).toHaveLength(0);
    expect(once.items[0]?.status).toBe("pending");
  });

  it("kind가 다르면 별개 기록이다", () => {
    const file = recordDecision(recordDecision({ version: 1, items: [] }, record()), record({ kind: "local-definition" }));
    expect(file.items).toHaveLength(2);
  });
});

function usage(p: Partial<ComponentUsage> & { name: string }): ComponentUsage {
  return { file: "src/App.tsx", line: 1, importedFrom: null, module: "", props: [], ...p };
}
function indexOf(components: ComponentUsage[]): Index {
  return { root: "/r", createdAt: "t", extractors: [], files: { scanned: 1, skipped: [] }, styles: [], components };
}

describe("decisionCandidates / listDecisions", () => {
  const index = indexOf([
    usage({ name: "Button", module: "src/a/Button", importedFrom: "src/a/Button" }),
    usage({ name: "Button", module: "src/a/Button", importedFrom: "src/a/Button" }),
    usage({ name: "Button", module: "src/b/Button", importedFrom: "src/b/Button" }),
    usage({ name: "Tag", file: "src/x.tsx", declaredLocally: true }),
    usage({ name: "Tag", file: "src/y.tsx", declaredLocally: true }),
  ]);

  it("중복 이름 다음에 지역 재정의 순으로 후보를 낸다", () => {
    expect(decisionCandidates(index)).toEqual([
      { item: "Button", kind: "duplicate", optionIds: ["src/a/Button", "src/b/Button"] },
      { item: "Tag", kind: "local-definition", optionIds: ["src/x.tsx", "src/y.tsx"] },
    ]);
  });

  it("기록이 없으면 전부 pending이다", () => {
    expect(listDecisions(index, { version: 1, items: [] })).toEqual([
      { item: "Button", kind: "duplicate", options: ["src/a/Button", "src/b/Button"], status: "pending" },
      { item: "Tag", kind: "local-definition", options: ["src/x.tsx", "src/y.tsx"], status: "pending" },
    ]);
  });

  it("decided 기록은 status decided와 chosen을 싣고 status로 거른다", () => {
    const file = recordDecision(
      { version: 1, items: [] },
      record({ options: ["src/a/Button", "src/b/Button"], status: "decided", chosen: "src/a/Button" }),
    );
    const all = listDecisions(index, file);
    expect(all[0]).toMatchObject({ item: "Button", status: "decided", decided: "src/a/Button" });
    expect(listDecisions(index, file, "pending").map((i) => i.item)).toEqual(["Tag"]);
    expect(listDecisions(index, file, "decided").map((i) => i.item)).toEqual(["Button"]);
  });

  it("파일에만 있는 기록(예: token-cluster)도 합친다", () => {
    const file = recordDecision(
      { version: 1, items: [] },
      record({ item: "primary", kind: "token-cluster", options: ["#3b82f6", "#3c83f7"], status: "decided", chosen: "#3b82f6" }),
    );
    const all = listDecisions(index, file);
    expect(all.map((i) => i.item)).toEqual(["Button", "Tag", "primary"]);
    expect(all[2]).toMatchObject({ kind: "token-cluster", status: "decided", decided: "#3b82f6" });
  });
});
