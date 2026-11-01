import { describe, expect, it } from "vitest";
import type { StyleUsage } from "@dsmith-dev/extractor-api";
import { buildDecisionCard, type CardInput } from "../src/decisions/card.js";
import type { DecisionCandidate, GitHistory } from "../src/decisions/model.js";
import type { Index } from "../src/index/indexer.js";
import type { ComponentUsage } from "../src/model/component-usage.js";
import { normalizeColor } from "../src/normalize/color.js";

function cu(p: Partial<ComponentUsage> & { name: string }): ComponentUsage {
  return { file: "src/App.tsx", line: 1, importedFrom: null, module: "", props: [], ...p };
}
function use(module: string, n: number, extra: Partial<ComponentUsage> = {}): ComponentUsage[] {
  return Array.from({ length: n }, (_, i) =>
    cu({ name: "Btn", module, importedFrom: module, file: `src/p${i}.tsx`, ...extra }),
  );
}
function hardcoded(file: string, raw: string, property: StyleUsage["property"] = "color"): StyleUsage {
  const hex = normalizeColor(raw);
  if (hex === null) throw new Error(raw);
  return { file, line: 1, column: 1, property, raw, normalized: hex, source: "hardcoded", extractor: "t" };
}
function spacing(file: string, px: number): StyleUsage {
  return { file, line: 1, column: 1, property: "padding", raw: `${px}px`, normalized: { kind: "length", px }, source: "hardcoded", extractor: "t" };
}
function tokenUsage(file: string, raw: string): StyleUsage {
  return { ...hardcoded(file, raw), source: "token" };
}
function indexOf(components: ComponentUsage[], styles: StyleUsage[] = []): Index {
  return { root: "/r", createdAt: "t", extractors: [], files: { scanned: 1, skipped: [] }, styles, components };
}

const candidate = (ids: string[]): DecisionCandidate => ({ item: "Btn", kind: "duplicate", optionIds: ids });
const noDs = () => false;

function build(over: Partial<CardInput> & Pick<CardInput, "index" | "candidate">) {
  return buildDecisionCard({ isDsModule: noDs, definitionFiles: {}, history: {}, ...over });
}

describe("buildDecisionCard 추천 규칙", () => {
  it("DS 옵션이 정확히 1개면 ds-module/high", () => {
    const card = build({
      candidate: candidate(["ui/A", "legacy/B"]),
      index: indexOf([...use("ui/A", 1), ...use("legacy/B", 5)]),
      isDsModule: (m) => m === "ui/A",
    });
    expect(card.recommendation).toEqual({
      optionId: "ui/A",
      reason: "DS 모듈(ui/A)에서 온 옵션",
      confidence: "high",
      rule: "ds-module",
    });
    expect(card.options.find((o) => o.id === "ui/A")?.isDs).toBe(true);
  });

  it("DS 옵션이 2개면 그 안에서 사용 수로 가린다", () => {
    const card = build({
      candidate: candidate(["ui/A", "ui/B", "x/C"]),
      index: indexOf([...use("ui/A", 1), ...use("ui/B", 2), ...use("x/C", 9)]),
      isDsModule: (m) => m.startsWith("ui/"),
    });
    expect(card.recommendation).toMatchObject({ optionId: "ui/B", rule: "usage", confidence: "medium" });
  });

  it("DS 없음 · 사용 3 vs 1 → usage/medium", () => {
    const card = build({ candidate: candidate(["A", "B"]), index: indexOf([...use("A", 3), ...use("B", 1)]) });
    expect(card.recommendation).toEqual({
      optionId: "A",
      reason: "사용 수 3회로 가장 많음",
      confidence: "medium",
      rule: "usage",
    });
  });

  it("사용 동률 · 토큰율 0.5 vs null → token-rate/low", () => {
    const card = build({
      candidate: candidate(["A", "B"]),
      index: indexOf(
        [...use("A", 1), ...use("B", 1)],
        [tokenUsage("a.tsx", "#111111"), hardcoded("a.tsx", "#222222")],
      ),
      definitionFiles: { A: "a.tsx", B: "b.tsx" },
    });
    expect(card.ruleCheck.tokenMatchRate).toEqual({ A: 0.5, B: null });
    expect(card.recommendation).toEqual({
      optionId: "A",
      reason: "토큰 일치율 50%로 가장 높음",
      confidence: "low",
      rule: "token-rate",
    });
  });

  it("전부 동률이면 정렬상 첫 옵션 · tie/low", () => {
    const card = build({ candidate: candidate(["B", "A"]), index: indexOf([...use("A", 1), ...use("B", 1)]) });
    expect(card.options.map((o) => o.id)).toEqual(["A", "B"]);
    expect(card.recommendation).toEqual({
      optionId: "A",
      reason: "근거가 동률 — 사람이 판단",
      confidence: "low",
      rule: "tie",
    });
  });
});

describe("buildDecisionCard 구성", () => {
  it("옵션은 usageCount 내림차순 → id 오름차순이고 files는 상위 5·count 내림차순", () => {
    const card = build({
      candidate: candidate(["A", "B"]),
      index: indexOf([...use("A", 7), ...use("B", 1)]),
    });
    expect(card.options.map((o) => [o.id, o.usageCount])).toEqual([["A", 7], ["B", 1]]);
    expect(card.options[0]?.files).toHaveLength(5);
    expect(card.options[0]?.module).toBe("A");
    expect(card.options[0]?.label).toBe("A");
  });

  it("impact: A(3회·2파일), B(1회·1파일) → A를 고르면 B 쪽 1회·1파일을 바꾼다", () => {
    const card = build({
      candidate: candidate(["A", "B"]),
      index: indexOf([
        cu({ name: "Btn", module: "A", importedFrom: "A", file: "x.tsx" }),
        cu({ name: "Btn", module: "A", importedFrom: "A", file: "x.tsx" }),
        cu({ name: "Btn", module: "A", importedFrom: "A", file: "y.tsx" }),
        cu({ name: "Btn", module: "B", importedFrom: "B", file: "z.tsx" }),
      ]),
    });
    expect(card.impact.byOption.A).toEqual({ callSites: 1, files: 1 });
    expect(card.impact.byOption.B).toEqual({ callSites: 3, files: 2 });
  });

  it("impact의 files는 다른 옵션들의 파일 합집합(중복 파일은 한 번)이다", () => {
    const card = build({
      candidate: candidate(["A", "B", "C"]),
      index: indexOf([
        cu({ name: "Btn", module: "A", importedFrom: "A", file: "x.tsx" }),
        cu({ name: "Btn", module: "B", importedFrom: "B", file: "x.tsx" }),
        cu({ name: "Btn", module: "C", importedFrom: "C", file: "x.tsx" }),
        cu({ name: "Btn", module: "C", importedFrom: "C", file: "y.tsx" }),
      ]),
    });
    expect(card.impact.byOption.A).toEqual({ callSites: 3, files: 2 });
  });

  it("props 차이는 그 옵션에만 있는 props로 낸다", () => {
    const card = build({
      candidate: candidate(["A", "B"]),
      index: indexOf([
        cu({ name: "Btn", module: "A", importedFrom: "A", props: ["size"] }),
        cu({ name: "Btn", module: "B", importedFrom: "B", props: ["size", "onClick"] }),
      ]),
    });
    expect(card.differences).toContainEqual({ aspect: "props", byOption: { B: ["onClick"] } });
    expect(card.differences).toContainEqual({ aspect: "module", byOption: { A: ["A"], B: ["B"] } });
    expect(card.differences.map((d) => d.aspect)).not.toContain("color");
  });

  it("정의 파일의 hardcoded 색·간격을 styleValues와 differences에 싣는다", () => {
    const card = build({
      candidate: candidate(["A", "B"]),
      index: indexOf(
        [...use("A", 1), ...use("B", 1)],
        [
          hardcoded("a.tsx", "#3B82F6"),
          hardcoded("a.tsx", "#3b82f6"),
          spacing("a.tsx", 12),
          hardcoded("b.tsx", "#3b82f6"),
          hardcoded("b.tsx", "#ef4444", "background-color"),
          spacing("b.tsx", 12),
          spacing("b.tsx", 8),
        ],
      ),
      definitionFiles: { A: "a.tsx", B: "b.tsx" },
    });
    const a = card.options.find((o) => o.id === "A");
    const b = card.options.find((o) => o.id === "B");
    expect(a?.file).toBe("a.tsx");
    expect(a?.styleValues).toEqual({ color: ["#3b82f6"], spacing: [12] });
    expect(b?.styleValues).toEqual({ color: ["#3b82f6", "#ef4444"], spacing: [8, 12] });
    expect(card.differences).toContainEqual({ aspect: "color", byOption: { B: ["#ef4444"] } });
    expect(card.differences).toContainEqual({ aspect: "spacing", byOption: { B: ["8px"] } });
  });

  it("정의 파일이 없는 옵션은 file이 없고 styleValues가 비며 토큰율은 null", () => {
    const card = build({ candidate: candidate(["A", "B"]), index: indexOf([...use("A", 1), ...use("B", 1)]) });
    expect(card.options[0]).not.toHaveProperty("file");
    expect(card.options[0]?.styleValues).toEqual({ color: [], spacing: [] });
    expect(card.ruleCheck.tokenMatchRate).toEqual({ A: null, B: null });
  });

  it("history가 빈 맵이면 필드가 없다", () => {
    const card = build({ candidate: candidate(["A", "B"]), index: indexOf([...use("A", 1), ...use("B", 1)]) });
    expect(card).not.toHaveProperty("history");
  });

  it("history는 정의 파일 이력을 옵션 id로 다시 묶고, 없는 옵션은 생략한다", () => {
    const h: GitHistory = {
      firstCommit: { sha: "aaaaaaa", date: "2025-01-01T00:00:00+00:00" },
      lastCommit: { sha: "bbbbbbb", date: "2025-06-01T00:00:00+00:00" },
      authorsCount: 2,
    };
    const card = build({
      candidate: candidate(["A", "B"]),
      index: indexOf([...use("A", 1), ...use("B", 1)]),
      definitionFiles: { A: "a.tsx", B: "b.tsx" },
      history: { "a.tsx": h },
    });
    expect(card.history).toEqual({ byOption: { A: h } });
  });

  it("기록이 decided면 decided를 싣고 pending이면 싣지 않는다", () => {
    const base = { candidate: candidate(["A", "B"]), index: indexOf([...use("A", 1), ...use("B", 1)]) };
    const decided = build({
      ...base,
      record: { item: "Btn", kind: "duplicate", status: "decided", options: ["A", "B"], chosen: "B", decidedAt: "2026-11-01T00:00:00.000Z", note: "n" },
    });
    expect(decided.decided).toEqual({ chosen: "B", decidedAt: "2026-11-01T00:00:00.000Z", note: "n" });
    const pending = build({ ...base, record: { item: "Btn", kind: "duplicate", status: "pending", options: ["A", "B"] } });
    expect(pending).not.toHaveProperty("decided");
  });
});

describe("buildDecisionCard local-definition", () => {
  it("정의 파일마다 옵션 1개, usageCount는 그 파일 안 사용 수, isDs는 확장자를 뗀 경로로 판정", () => {
    const card = buildDecisionCard({
      candidate: { item: "Tag", kind: "local-definition", optionIds: ["src/ui/x.tsx", "src/y.tsx"] },
      index: indexOf([
        cu({ name: "Tag", file: "src/ui/x.tsx", declaredLocally: true, props: ["a"] }),
        cu({ name: "Tag", file: "src/ui/x.tsx", declaredLocally: true }),
        cu({ name: "Tag", file: "src/y.tsx", declaredLocally: true }),
        cu({ name: "Tag", file: "src/z.tsx", importedFrom: "src/ui/x", module: "src/ui/x" }),
      ]),
      isDsModule: (m) => m.startsWith("src/ui"),
      definitionFiles: {},
      history: {},
    });
    expect(card.options.map((o) => [o.id, o.label, o.file, o.usageCount, o.isDs])).toEqual([
      ["src/ui/x.tsx", "src/ui/x.tsx", "src/ui/x.tsx", 2, true],
      ["src/y.tsx", "src/y.tsx", "src/y.tsx", 1, false],
    ]);
    expect(card.options[0]).not.toHaveProperty("module");
    expect(card.recommendation).toMatchObject({ optionId: "src/ui/x.tsx", rule: "ds-module", confidence: "high" });
  });
});
