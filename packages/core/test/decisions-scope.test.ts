import { describe, expect, it } from "vitest";
import type { StyleUsage } from "@dsmith-dev/extractor-api";
import { buildDecisionCard, type CardInput } from "../src/decisions/card.js";
import type { DecisionCandidate } from "../src/decisions/candidates.js";
import type { Index } from "../src/index/indexer.js";
import type { ComponentUsage } from "../src/model/component-usage.js";
import type { Token } from "../src/model/token.js";
import { normalizeColor } from "../src/normalize/color.js";

function hc(file: string, line: number, raw: string): StyleUsage {
  const hex = normalizeColor(raw);
  if (hex === null) throw new Error(raw);
  return { file, line, column: 1, property: "color", raw, normalized: hex, source: "hardcoded", extractor: "t" };
}
function cu(module: string, i: number): ComponentUsage {
  return { name: "Button", file: `src/p${i}.tsx`, line: 1, importedFrom: module, module, props: [] };
}
function indexOf(components: ComponentUsage[], styles: StyleUsage[]): Index {
  return { root: "/r", createdAt: "t", extractors: [], files: { scanned: 1, skipped: [] }, styles, components };
}
const candidate: DecisionCandidate = { item: "Button", kind: "duplicate", optionIds: ["ui/Button", "legacy/Button"] };
const base = { candidate, isDsModule: () => false, history: {} };

describe("선언 단위 스타일 범위", () => {
  const styles = [
    hc("ui/Button.tsx", 3, "#111111"),
    hc("ui/Button.tsx", 9, "#222222"),
    hc("ui/Button.tsx", 14, "#333333"),
  ];
  const index = indexOf([cu("ui/Button", 0), cu("legacy/Button", 1)], styles);
  const definitionFiles = { "ui/Button": "ui/Button.tsx", "legacy/Button": null };

  it("다른 컴포넌트 선언 범위의 줄만 빼고 모듈 상수는 남긴다", () => {
    const card = buildDecisionCard({
      ...base,
      index,
      definitionFiles,
      excludeRanges: { "ui/Button.tsx": [{ startLine: 7, endLine: 12 }] },
    });
    expect(card.options.find((o) => o.id === "ui/Button")?.styleValues.color).toEqual(["#111111", "#333333"]);
    expect(card.styleScope).toBe("declaration");
  });

  it("범위가 없으면 3a 카드와 같다", () => {
    const plain = buildDecisionCard({ ...base, index, definitionFiles });
    const empty = buildDecisionCard({ ...base, index, definitionFiles, excludeRanges: {} });
    expect(empty).toEqual(plain);
    expect(plain.styleScope).toBe("file");
    expect(plain.ruleCheck).not.toHaveProperty("tokenMatchRate");
  });
});

describe("tokenMatchRate", () => {
  const primary: Token = {
    name: "--color-primary",
    category: "color",
    value: "#3b82f6",
    normalized: normalizeColor("#3b82f6") as never,
  } as Token;
  const index = indexOf(
    [cu("ui/Button", 0), cu("legacy/Button", 1)],
    [hc("ui/Button.tsx", 1, "#3b82f6"), hc("ui/Button.tsx", 2, "#123456")],
  );
  const input: CardInput = { ...base, index, definitionFiles: { "ui/Button": "ui/Button.tsx", "legacy/Button": null } };

  it("exact|close 비율을 낸다", () => {
    const card = buildDecisionCard({ ...input, tokens: [primary] });
    expect(card.ruleCheck.tokenMatchRate).toEqual({ "ui/Button": 0.5, "legacy/Button": null });
  });

  it("tokens가 없으면 필드가 없다", () => {
    expect(buildDecisionCard({ ...input, tokens: [] }).ruleCheck).not.toHaveProperty("tokenMatchRate");
  });

  it("사용 동률이면 일치율이 높은 쪽을 token-rate로 추천", () => {
    const tied = indexOf(
      [cu("ui/Button", 0), cu("legacy/Button", 1)],
      [hc("ui/Button.tsx", 1, "#3b82f6"), hc("legacy/Button.tsx", 1, "#123456")],
    );
    const card = buildDecisionCard({
      ...base,
      index: tied,
      definitionFiles: { "ui/Button": "ui/Button.tsx", "legacy/Button": "legacy/Button.tsx" },
      tokens: [primary],
    });
    expect(card.recommendation).toMatchObject({ optionId: "ui/Button", rule: "token-rate" });
    expect(card.recommendation.reason).toContain("토큰 일치율 100%");
  });
});

describe("explainDecision 선언 범위 계산", () => {
  it("정의 파일의 다른 컴포넌트 선언만 뺀다", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const { explainDecision } = await import("../src/decisions/explain.js");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dsmith-scope-"));
    try {
      await fs.mkdir(path.join(root, "ui"), { recursive: true });
      await fs.writeFile(
        path.join(root, "ui/Button.tsx"),
        [
          "export function Button() {", //1
          "  return null;", //2
          "}", //3
          "const shared = 1;", //4
          "export function IconButton() {", //5
          "  return null;", //6
          "}", //7
        ].join("\n"),
      );
      const idx = indexOf(
        [cu("ui/Button", 0), cu("legacy/Button", 1)],
        [hc("ui/Button.tsx", 2, "#111111"), hc("ui/Button.tsx", 4, "#333333"), hc("ui/Button.tsx", 6, "#222222")],
      );
      const result = await explainDecision(root, idx, "Button", { isDsModule: () => false, git: false });
      if (!("card" in result)) throw new Error("card expected");
      expect(result.card.styleScope).toBe("declaration");
      expect(result.card.options.find((o) => o.id === "ui/Button")?.styleValues.color).toEqual(["#111111", "#333333"]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("styled 파일은 자기 스타일을 잃지 않는다", () => {
  it("SIZES·styled Root가 있는 파일은 범위 없이 file", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const { explainDecision } = await import("../src/decisions/explain.js");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dsmith-scope2-"));
    try {
      await fs.mkdir(path.join(root, "ui"), { recursive: true });
      await fs.writeFile(
        path.join(root, "ui/Button.tsx"),
        ["const SIZES = { sm: 1 };", "const Root = styled.button`", "  color: #111111;", "`;", "export function Button() { return null; }"].join("\n"),
      );
      const idx = indexOf([cu("ui/Button", 0), cu("legacy/Button", 1)], [hc("ui/Button.tsx", 3, "#111111")]);
      const result = await explainDecision(root, idx, "Button", { isDsModule: () => false, git: false });
      if (!("card" in result)) throw new Error("card");
      expect(result.card.styleScope).toBe("file");
      expect(result.card.options.find((o) => o.id === "ui/Button")?.styleValues.color).toEqual(["#111111"]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("같은 문장의 선언자가 여럿이면 item 자신의 줄은 뺀 범위만 제외", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const { explainDecision } = await import("../src/decisions/explain.js");
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dsmith-scope3-"));
    try {
      await fs.mkdir(path.join(root, "ui"), { recursive: true });
      await fs.writeFile(path.join(root, "ui/Button.tsx"), ["const Other = () => 1, Button = () => 2;", "const Icon = () => 3;"].join("\n"));
      const idx = indexOf([cu("ui/Button", 0), cu("legacy/Button", 1)], [hc("ui/Button.tsx", 1, "#111111"), hc("ui/Button.tsx", 2, "#222222")]);
      const result = await explainDecision(root, idx, "Button", { isDsModule: () => false, git: false });
      if (!("card" in result)) throw new Error("card");
      expect(result.card.options.find((o) => o.id === "ui/Button")?.styleValues.color).toEqual(["#111111"]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("tokenMatchRate: token 소스 포함", () => {
  it("전부 token인 A가 절반 hardcoded인 B를 이긴다", () => {
    const primary = { name: "--p", category: "color", value: "#3b82f6", normalized: normalizeColor("#3b82f6") } as Token;
    const tokenUse = (file: string): StyleUsage => ({ ...hc(file, 1, "#3b82f6"), source: "token" });
    const idx = indexOf(
      [cu("a/Button", 0), cu("b/Button", 1)],
      [tokenUse("a/Button.tsx"), tokenUse("a/Button.tsx"), hc("b/Button.tsx", 0, "#3b82f6"), hc("b/Button.tsx", 0, "#123456")].map((u, i) => ({ ...u, line: i + 1 })),
    );
    const card = buildDecisionCard({
      candidate: { item: "Button", kind: "duplicate", optionIds: ["a/Button", "b/Button"] },
      index: idx,
      isDsModule: () => false,
      history: {},
      definitionFiles: { "a/Button": "a/Button.tsx", "b/Button": "b/Button.tsx" },
      tokens: [primary],
    });
    expect(card.ruleCheck.tokenMatchRate).toEqual({ "a/Button": 1, "b/Button": 0.5 });
    expect(card.recommendation).toMatchObject({ optionId: "a/Button", rule: "token-rate" });
  });
});
