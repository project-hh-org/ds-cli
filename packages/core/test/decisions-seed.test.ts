import { describe, expect, it } from "vitest";
import { seedDecisions } from "../src/decisions/seed.js";
import type { DecisionsFile } from "../src/decisions/model.js";
import type { Index } from "../src/index/indexer.js";
import type { ComponentUsage } from "../src/model/component-usage.js";

function dup(name: string, modules: string[], n = 1): ComponentUsage[] {
  return modules.flatMap((m) =>
    Array.from({ length: n }, (_, i) => ({ name, file: `src/${m}-${i}.tsx`, line: 1, importedFrom: m, module: m, props: [] })),
  );
}
const index: Index = {
  root: "/r", createdAt: "t", extractors: [], files: { scanned: 1, skipped: [] }, styles: [],
  components: [...dup("Button", ["a/Button", "b/Button"], 2), ...dup("Badge", ["a/Badge", "b/Badge"])],
};
const empty: DecisionsFile = { version: 1, items: [] };
const clusters = [
  { item: "blue-400", options: ["#3b82f6", "#3c83f7"] },
  { item: "blue-900", options: ["#1e3a8a"] },
];

describe("seedDecisions", () => {
  it("duplicate 2 + token-cluster 1(옵션 1개짜리 제외)을 pending으로 추가", () => {
    const { file, added } = seedDecisions(empty, index, clusters);
    expect(added.map((r) => [r.item, r.kind, r.status])).toEqual([
      ["Button", "duplicate", "pending"],
      ["Badge", "duplicate", "pending"],
      ["blue-400", "token-cluster", "pending"],
    ]);
    expect(added[2]?.options).toEqual(["#3b82f6", "#3c83f7"]);
    expect(file.items).toHaveLength(3);
    expect(empty.items).toHaveLength(0);
  });

  it("같은 입력으로 다시 시드하면 추가 0, 결정된 기록은 그대로", () => {
    const first = seedDecisions(empty, index, clusters).file;
    const decided: DecisionsFile = {
      version: 1,
      items: first.items.map((r) => (r.item === "Button" ? { ...r, status: "decided" as const, chosen: "a/Button" } : r)),
    };
    const second = seedDecisions(decided, index, clusters);
    expect(second.added).toEqual([]);
    expect(second.file).toEqual(decided);
  });

  it("limits로 종류별 상위 N개만", () => {
    const { added } = seedDecisions(empty, index, clusters, { duplicate: 1, tokenCluster: 0 });
    expect(added.map((r) => r.item)).toEqual(["Button"]);
  });
});
