import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  chooseDecision,
  draftCoverage,
  draftToTokens,
  buildTokenDraft,
  clusterColors,
  listDecisions,
  parseTsx,
  readCssVariableTokens,
  readDecisions,
  readIndex,
  readW3cTokens,
  type Index,
} from "@dsmith-dev/core";
import { formatInitSummary, runInit, type InitResult } from "../src/run.js";
import { auditFixture, copyFixture, forceStateZero, listFiles, treeHash } from "./helpers.js";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

async function legacyDemo(stateZero: boolean): Promise<string> {
  const root = copyFixture("examples/legacy-demo");
  roots.push(root);
  await auditFixture(root);
  if (stateZero) await forceStateZero(root);
  return root;
}

const NOW = new Date(2026, 10, 1, 12);
const run = (root: string, extra: Partial<Parameters<typeof runInit>[0]> = {}): Promise<InitResult> =>
  runInit({ root, version: "0.0.0-test", now: NOW, ...extra });
const read = (root: string, rel: string): string => fs.readFileSync(path.join(root, rel), "utf-8");
const statuses = (r: InitResult): string[] => r.outcomes.map((o) => o.status);

describe("runInit: 전제", () => {
  it("index가 없으면 audit 안내", async () => {
    const root = copyFixture("examples/legacy-demo");
    roots.push(root);
    await expect(run(root)).rejects.toThrow("먼저 `dsmith audit`");
  });
});

describe("runInit: legacy-demo 상태 0", () => {
  it("--all: 토큰 3종·스캐폴드·결정 시드·리포트·매니페스트를 쓴다", async () => {
    const root = await legacyDemo(true);
    const index = (await readIndex(root)) as Index;
    const r = await run(root, { all: true });

    expect(r.outDir).toBe("design-system");
    expect(statuses(r).slice(0, 3)).toEqual(["created", "created", "created"]);
    const files = listFiles(root, "design-system");
    expect(files).toEqual(
      expect.arrayContaining([
        "design-system/tokens.json",
        "design-system/tokens.css",
        "design-system/tokens.ts",
        "design-system/components/Button.tsx",
        "design-system/components/Badge.tsx",
      ]),
    );
    expect(r.scaffolds.map((s) => [s.name, s.status, s.basis])).toEqual([
      ["Button", "created", "recommended"],
      ["Badge", "created", "recommended"],
    ]);
    for (const s of r.scaffolds) {
      const ast = parseTsx(read(root, s.file), s.file);
      expect((ast as unknown as { errors?: unknown[] }).errors ?? []).toEqual([]);
    }

    // 토큰 수가 세 파일에서 같다
    expect(r.tokens.color).toBeGreaterThan(0);
    const cssTokens = readCssVariableTokens(read(root, "design-system/tokens.css"), "design-system/tokens.css");
    expect(cssTokens.length).toBe(r.tokens.total);
    const w3c = readW3cTokens(read(root, "design-system/tokens.json"), "design-system/tokens.json");
    expect(w3c.tokens.length).toBe(r.tokens.total);
    expect(r.tokens.total).toBe(r.tokens.color + r.tokens.spacing + r.tokens.radius + r.tokens.fontSize);

    // 색 토큰 수 = audit 색 클러스터 수 (2026-11-01 기준 6)
    expect(r.tokens.color).toBe(clusterColors((await readIndex(root) as Index).styles).length);
    expect(r.tokens.color).toBe(6);
    expect(r.alphaDropped).toEqual([{ raw: "rgba(17, 24, 39, 0.5)", hex: "#111827", count: 1 }]);
    expect(read(root, r.report as string)).toContain("알파가 빠진 색");
    const hardcodedColors = new Set(
      index.styles.filter((u) => u.source === "hardcoded" && u.normalized.kind === "color").map((u) => u.normalized),
    );
    expect(hardcodedColors.size).toBeGreaterThanOrEqual(r.tokens.color);

    // 리포트·커버리지
    expect(r.report).toBe(".dsmith/reports/init-2026-11-01.md");
    const report = read(root, r.report as string);
    const expected = draftCoverage(index.styles, draftToTokens(buildTokenDraft(index.styles, { excludeDirs: ["design-system"] })), {
      excludeDirs: ["design-system"],
    });
    expect(r.coverage).toEqual(expected);
    expect(report).toContain(`전체: ${expected.replaceable}/${expected.total}`);
    expect(report).toContain("숫자의 구성");
    expect(report).not.toContain(root);

    // 결정 시드 + 매니페스트
    const decisions = await readDecisions(root);
    expect(decisions.items.filter((i) => i.kind === "duplicate").map((i) => i.item).sort()).toEqual(["Badge", "Button"]);
    expect(decisions.items.every((i) => i.status === "pending")).toBe(true);
    expect(r.decisions.pending).toBe(decisions.items.length);
    const manifest = JSON.parse(read(root, ".dsmith/init.json")) as { tool: string; entries: Record<string, unknown> };
    expect(manifest.tool).toBe("init");
    expect(Object.keys(manifest.entries)).toEqual(
      expect.arrayContaining([
        "design-system/tokens.json",
        "design-system/tokens.css",
        "design-system/tokens.ts",
      ]),
    );
    expect(formatInitSummary(r)).toContain("토큰: 색");
  });

  it("두 번째 실행: 전부 unchanged, 트리 해시 동일", async () => {
    const root = await legacyDemo(true);
    await run(root, { all: true });
    const before = treeHash(root);
    const second = await run(root, { all: true });
    expect(statuses(second).every((s) => s === "unchanged")).toBe(true);
    expect(second.decisions.added).toBe(0);
    expect(treeHash(root)).toBe(before);
  });

  it("--dry-run: 파일 시스템 무변경(.dsmith 포함), diff 제공, report null", async () => {
    const root = await legacyDemo(true);
    const before = treeHash(root);
    const reportsBefore = listFiles(root, ".dsmith/reports");
    const r = await run(root, { all: true, dryRun: true });
    expect(treeHash(root)).toBe(before);
    expect(listFiles(root, ".dsmith/reports")).toEqual(reportsBefore);
    expect(r.report).toBeNull();
    expect(r.dryRun).toBe(true);
    expect(r.outcomes.every((o) => o.status === "created" && (o.diff ?? "") !== "")).toBe(true);
    expect(fs.existsSync(path.join(root, "design-system"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".dsmith/init.json"))).toBe(false);
    expect(formatInitSummary(r)).toContain("dry-run");
  });

  it("--out: 지정한 디렉터리에 쓴다", async () => {
    const root = await legacyDemo(true);
    const r = await run(root, { all: true, outDir: "src/ds/" });
    expect(r.outDir).toBe("src/ds");
    expect(fs.existsSync(path.join(root, "src/ds/tokens.css"))).toBe(true);
    expect(fs.existsSync(path.join(root, "src/ds/components/Button.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(root, "design-system"))).toBe(false);
  });

  it("out 디렉터리 검증 실패", async () => {
    const root = await legacyDemo(true);
    await expect(run(root, { outDir: "../x" })).rejects.toThrow("--out");
    await expect(run(root, { outDir: ".dsmith" })).rejects.toThrow("--out");
    await expect(run(root, { outDir: "/abs" })).rejects.toThrow("--out");
  });

  it("사용자가 고친 tokens.css는 skipped-modified, --force면 json·css·ts를 함께 덮어쓴다", async () => {
    const root = await legacyDemo(true);
    await run(root, { all: true });
    const cssPath = path.join(root, "design-system/tokens.css");
    const original = fs.readFileSync(cssPath, "utf-8");
    fs.writeFileSync(cssPath, original.replace(":root {", ":root {\n  --mine: 1px;"));
    // 초안이 바뀌도록 색 선택을 기록한다
    const decisions = await readDecisions(root);
    const cluster = decisions.items.find((i) => i.kind === "token-cluster");
    expect(cluster).toBeDefined();
    const index = (await readIndex(root)) as Index;
    await chooseDecision(root, index, (cluster as { item: string }).item, (cluster as { options: string[] }).options[1] as string, {
      kind: "token-cluster",
    });
    const jsonBefore = read(root, "design-system/tokens.json");

    const blocked = await run(root, { all: true });
    expect(blocked.outcomes[1]?.status).toBe("skipped-modified");
    // json은 짝이 막혀 있어 함께 건너뛴다
    expect(blocked.outcomes[0]?.status).toBe("skipped-modified");
    expect(read(root, "design-system/tokens.json")).toBe(jsonBefore);
    expect(read(root, "design-system/tokens.css")).toContain("--mine");
    expect(formatInitSummary(blocked)).toContain("--force");

    const forced = await run(root, { all: true, force: true });
    expect(forced.outcomes[0]?.status).toBe("updated");
    expect(forced.outcomes[1]?.status).toBe("updated");
    expect(read(root, "design-system/tokens.css")).not.toContain("--mine");
    expect(read(root, "design-system/tokens.json")).not.toBe(jsonBefore);
  });

  it("기존 스캐폴드는 --force여도 덮어쓰지 않는다", async () => {
    const root = await legacyDemo(true);
    await run(root, { all: true });
    const button = path.join(root, "design-system/components/Button.tsx");
    fs.writeFileSync(button, "// 내가 고침\n");
    const r = await run(root, { all: true, force: true });
    expect(r.scaffolds.find((s) => s.name === "Button")?.status).toBe("skipped-exists");
    expect(fs.readFileSync(button, "utf-8")).toBe("// 내가 고침\n");
  });
});

describe("runInit: legacy-demo 상태 1 (로컬 DS 있음)", () => {
  it("--all 없이: 토큰만, 스캐폴드 0, pending ≥ 2 → 결정하면 스캐폴드", async () => {
    const root = await legacyDemo(false);
    const first = await run(root);
    expect(first.scaffolds).toEqual([]);
    expect(first.decisions.pending).toBeGreaterThanOrEqual(2);
    expect(fs.existsSync(path.join(root, "design-system/tokens.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, "design-system/components"))).toBe(false);

    const index = (await readIndex(root)) as Index;
    const badge = listDecisions(index, await readDecisions(root)).find((i) => i.item === "Badge" && i.kind === "duplicate");
    expect(badge).toBeDefined();
    const local = (badge as { options: string[] }).options.find((o) => !o.includes("ui/")) ?? (badge as { options: string[] }).options[0];
    await chooseDecision(root, index, "Badge", local as string, { kind: "duplicate" });
    const second = await run(root);
    expect(second.scaffolds.map((s) => [s.name, s.basis, s.status])).toEqual([["Badge", "decided", "created"]]);
    expect(fs.existsSync(path.join(root, "design-system/components/Badge.tsx"))).toBe(true);
  });

  it("--all: 이미 DS에 있는 Button은 건너뛴다", async () => {
    const root = await legacyDemo(false);
    const r = await run(root, { all: true });
    const skipped = r.skippedScaffolds.find((s) => s.item === "Button");
    expect(skipped?.reason).toMatch(/^이미 DS에 있음: /);
    expect(r.scaffolds.some((s) => s.name === "Button")).toBe(false);
  });
});

describe("runInit: token-cluster 결정", () => {
  it("고른 hex가 tokens.json에 반영된다", async () => {
    const root = await legacyDemo(true);
    await run(root);
    const index = (await readIndex(root)) as Index;
    const cluster = (await readDecisions(root)).items.find((i) => i.kind === "token-cluster");
    expect(cluster).toBeDefined();
    const picked = (cluster as { options: string[] }).options[1] as string;
    await chooseDecision(root, index, (cluster as { item: string }).item, picked, { kind: "token-cluster" });
    await run(root, { force: true });
    const json = JSON.parse(read(root, "design-system/tokens.json")) as Record<string, Record<string, Record<string, unknown>>>;
    const key = (cluster as { item: string }).item;
    const token = json.color?.[key] as { $value: { hex: string }; $extensions: Record<string, { chosen?: string }> };
    expect(token.$value.hex).toBe(picked.toLowerCase());
    expect(token.$extensions["dev.dsmith"]?.chosen).toBe(picked.toLowerCase());
  });
});

describe("runInit: inline-app", () => {
  it("fixtures/inline-app에서도 토큰 파일을 쓴다", async () => {
    const root = copyFixture("fixtures/inline-app");
    roots.push(root);
    await auditFixture(root);
    const r = await run(root, { all: true });
    expect(r.tokens.total).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(root, "design-system/tokens.css"))).toBe(true);
  });
});
