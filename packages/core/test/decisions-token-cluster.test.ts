import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StyleUsage } from "@dsmith-dev/extractor-api";
import { chooseDecision } from "../src/decisions/choose.js";
import { explainDecision } from "../src/decisions/explain.js";
import { listDecisions } from "../src/decisions/candidates.js";
import { readDecisions, writeDecisions } from "../src/decisions/store.js";
import type { DecisionsFile } from "../src/decisions/model.js";
import type { Index } from "../src/index/indexer.js";
import type { ComponentUsage } from "../src/model/component-usage.js";
import { normalizeColor } from "../src/normalize/color.js";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-tc-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function hc(file: string, raw: string): StyleUsage {
  const hex = normalizeColor(raw);
  if (hex === null) throw new Error(raw);
  return { file, line: 1, column: 1, property: "color", raw, normalized: hex, source: "hardcoded", extractor: "t" };
}
function indexOf(styles: StyleUsage[], components: ComponentUsage[] = []): Index {
  return { root: "/r", createdAt: "t", extractors: [], files: { scanned: 1, skipped: [] }, styles, components };
}
const A = "#3b82f6";
const B = "#3c83f7";
const index = indexOf([hc("a.tsx", A), hc("b.tsx", A), hc("c.tsx", A), hc("d.tsx", B)]);
const decisions: DecisionsFile = {
  version: 1,
  items: [{ item: "blue-400", kind: "token-cluster", status: "pending", options: [A, B] }],
};

describe("token-cluster 카드", () => {
  it("옵션 2개, 사용 수 많은 쪽을 usage/medium으로 추천, impact는 다른 옵션 사용 수", async () => {
    const result = await explainDecision(tmp, index, "blue-400", { isDsModule: () => false, decisions, git: false });
    if (!("card" in result)) throw new Error(JSON.stringify(result));
    const { card } = result;
    expect(card.kind).toBe("token-cluster");
    expect(card.options.map((o) => [o.id, o.usageCount])).toEqual([[A, 3], [B, 1]]);
    expect(card.options[0]).toMatchObject({ label: A, props: [], isDs: false, styleValues: { color: [A], spacing: [] }, files: ["a.tsx", "b.tsx", "c.tsx"] });
    expect(card.recommendation).toEqual({ optionId: A, reason: "사용 수 3회로 가장 많음", confidence: "medium", rule: "usage" });
    expect(card.impact.byOption[A]).toEqual({ callSites: 1, files: 1 });
    expect(card.impact.byOption[B]).toEqual({ callSites: 3, files: 3 });
    expect(card.differences).toEqual([{ aspect: "color", byOption: { [A]: [A], [B]: [B] } }]);
    expect(card.ruleCheck.tokenUsageRate).toEqual({ [A]: null, [B]: null });
    expect(card.styleScope).toBe("file");
    expect(card).not.toHaveProperty("history");
  });

  it("사용 수 동률이면 tie/low", async () => {
    const tied = indexOf([hc("a.tsx", A), hc("d.tsx", B)]);
    const result = await explainDecision(tmp, tied, "blue-400", { isDsModule: () => false, decisions, git: false });
    if (!("card" in result)) throw new Error("card");
    expect(result.card.recommendation).toMatchObject({ rule: "tie", confidence: "low" });
  });

  it("decisions에 없으면 not-found", async () => {
    const result = await explainDecision(tmp, index, "blue-400", { isDsModule: () => false, git: false });
    expect(result).toMatchObject({ error: "not-found" });
  });
});

describe("chooseDecision token-cluster", () => {
  it("선택을 기록하고, 없는 hex는 선택지 아님", async () => {
    await writeDecisions(tmp, decisions);
    const record = await chooseDecision(tmp, index, "blue-400", B, { kind: "token-cluster", now: new Date("2026-11-01T00:00:00Z") });
    expect(record).toMatchObject({ item: "blue-400", kind: "token-cluster", status: "decided", chosen: B, options: [A, B] });
    expect((await readDecisions(tmp)).items[0]).toMatchObject({ status: "decided", chosen: B });
    await expect(chooseDecision(tmp, index, "blue-400", "#000000", { kind: "token-cluster" })).rejects.toThrow("선택지 아님");
  });
});

describe("listDecisions stale", () => {
  it("decided duplicate의 chosen이 현재 후보가 아니면 stale", () => {
    const comps: ComponentUsage[] = ["a/Button", "b/Button"].map((m) => ({
      name: "Button", file: "src/App.tsx", line: 1, importedFrom: m, module: m, props: [],
    }));
    const file: DecisionsFile = {
      version: 1,
      items: [{ item: "Button", kind: "duplicate", status: "decided", options: ["a/Button", "b/Button"], chosen: "src/old/Button" }],
    };
    expect(listDecisions(indexOf([], comps), file)).toEqual([
      { item: "Button", kind: "duplicate", options: ["a/Button", "b/Button"], status: "decided", chosen: "src/old/Button", stale: true },
    ]);
    const fresh: DecisionsFile = { version: 1, items: [{ ...file.items[0]!, chosen: "a/Button" }] };
    expect(listDecisions(indexOf([], comps), fresh)[0]).not.toHaveProperty("stale");
  });

  it("token-cluster chosen hex가 index에서 사라지면 stale", () => {
    const file: DecisionsFile = {
      version: 1,
      items: [{ item: "blue-400", kind: "token-cluster", status: "decided", options: [A, B], chosen: B }],
    };
    expect(listDecisions(index, file)[0]).toMatchObject({ kind: "token-cluster", chosen: B });
    expect(listDecisions(index, file)[0]).not.toHaveProperty("stale");
    expect(listDecisions(indexOf([hc("a.tsx", A)]), file)[0]).toMatchObject({ stale: true });
  });
});

describe("stale: 결정이 적용된 경우는 stale이 아니다", () => {
  it("duplicate가 하나로 합쳐져 후보가 사라지면 stale 아님", () => {
    const comps: ComponentUsage[] = [{ name: "Button", file: "src/App.tsx", line: 1, importedFrom: "a/Button", module: "a/Button", props: [] }];
    const file: DecisionsFile = {
      version: 1,
      items: [{ item: "Button", kind: "duplicate", status: "decided", options: ["a/Button", "b/Button"], chosen: "a/Button" }],
    };
    expect(listDecisions(indexOf([], comps), file)[0]).not.toHaveProperty("stale");
  });

  it("token-cluster의 모든 구성원이 hardcoded에서 사라지면 stale 아님", () => {
    const file: DecisionsFile = {
      version: 1,
      items: [{ item: "blue-400", kind: "token-cluster", status: "decided", options: [A, B], chosen: A }],
    };
    expect(listDecisions(indexOf([]), file)[0]).not.toHaveProperty("stale");
  });

  it("explain 카드: 선택지에서 빠진 chosen은 decided.stale", async () => {
    const stale: DecisionsFile = {
      version: 1,
      items: [{ item: "blue-400", kind: "token-cluster", status: "decided", options: [A, B], chosen: B, decidedAt: "t" }],
    };
    const result = await explainDecision(tmp, indexOf([hc("a.tsx", A)]), "blue-400", { isDsModule: () => false, decisions: stale, git: false });
    if (!("card" in result)) throw new Error("card");
    expect(result.card.decided).toEqual({ chosen: B, decidedAt: "t", stale: true });
  });

  it("token-cluster 선택은 대문자 hex도 받는다", async () => {
    await writeDecisions(tmp, decisions);
    const record = await chooseDecision(tmp, index, "blue-400", B.toUpperCase(), { kind: "token-cluster" });
    expect(record.chosen).toBe(B);
    await expect(chooseDecision(tmp, index, "blue-400", "#000000", { kind: "token-cluster" })).rejects.toThrow('--choose "#3b82f6"');
  });
});
