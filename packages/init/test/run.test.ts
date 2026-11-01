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
    const tsBefore = read(root, "design-system/tokens.ts");

    const blocked = await run(root, { all: true });
    expect(blocked.outcomes[1]?.status).toBe("skipped-modified");
    // json은 짝이 막혀 있어 함께 건너뛴다
    expect(blocked.outcomes[0]?.status).toBe("skipped-modified");
    expect(blocked.outcomes[0]?.reason).toContain("tokens.css 사용자 수정으로 함께 보류");
    // ts도 같은 묶음이라 보류된다(세 파일이 어긋나지 않는다)
    expect(blocked.outcomes[2]?.status).toBe("skipped-modified");
    expect(read(root, "design-system/tokens.ts")).toBe(tsBefore);
    expect(read(root, "design-system/tokens.json")).toBe(jsonBefore);
    expect(read(root, "design-system/tokens.css")).toContain("--mine");
    expect(formatInitSummary(blocked)).toContain("--force");

    const forced = await run(root, { all: true, force: true });
    expect(forced.outcomes[0]?.status).toBe("updated");
    expect(forced.outcomes[1]?.status).toBe("updated");
    expect(forced.outcomes[2]?.status).toBe("updated");
    expect(read(root, "design-system/tokens.ts")).not.toBe(tsBefore);
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

describe("runInit: 보강 (fix round 1)", () => {
  it("pending token-cluster 기록의 options를 클러스터 구성원 변화에 맞춰 갱신하고 decided는 건드리지 않는다", async () => {
    const root = await legacyDemo(true);
    const first = await run(root);
    expect(first.decisions.refreshed).toBe(0);
    const before = await readDecisions(root);
    const blue = before.items.find((i) => i.kind === "token-cluster" && i.item === "color-blue-400".replace("color-", ""));
    expect(blue?.status).toBe("pending");
    const red = before.items.find((i) => i.kind === "token-cluster" && i.item === "red-500");
    expect(red).toBeDefined();
    // red-500은 결정해 두고, blue-400 근처에 새 색을 추가한다
    const index = (await readIndex(root)) as Index;
    await chooseDecision(root, index, "red-500", (red as { options: string[] }).options[0] as string, { kind: "token-cluster" });
    fs.writeFileSync(
      path.join(root, "src/Extra.tsx"),
      'export const Extra = () => <div style={{ color: "#3b81f6", background: "#ee4444" }}>x</div>;\n',
    );
    await auditFixture(root);
    const second = await run(root, { force: true });
    expect(second.decisions.refreshed).toBeGreaterThanOrEqual(1);
    const after = await readDecisions(root);
    const blueAfter = after.items.find((i) => i.kind === "token-cluster" && i.item === "blue-400");
    expect(blueAfter?.options).toContain("#3b81f6");
    expect(blueAfter?.status).toBe("pending");
    const redAfter = after.items.find((i) => i.kind === "token-cluster" && i.item === "red-500");
    expect(redAfter?.status).toBe("decided");
    expect(redAfter?.options).toEqual((red as { options: string[] }).options);
  });

  it("Tailwind 대괄호 알파(#rrggbbaa, rgba())도 알파 제외 색으로 센다", async () => {
    const root = copyFixture("examples/legacy-demo", {
      "src/TwAlpha.tsx":
        'export const T = () => <div className="bg-[#11182780] hover:text-[rgba(0,0,0,0.5)] text-[#111827]">x</div>;\n',
    });
    roots.push(root);
    await auditFixture(root);
    await forceStateZero(root);
    const r = await run(root);
    const raws = r.alphaDropped.map((a) => a.raw);
    expect(raws).toContain("bg-[#11182780]");
    expect(raws).toContain("hover:text-[rgba(0,0,0,0.5)]");
    expect(raws).not.toContain("text-[#111827]");
    expect(formatInitSummary(r)).toMatch(/알파 \d+건 포함/);
  });

  it("사용자가 지운 스캐폴드는 다시 만들지 않고, --force면 재생성한다", async () => {
    const root = await legacyDemo(true);
    await run(root, { all: true });
    fs.rmSync(path.join(root, "design-system/components/Button.tsx"));
    const r = await run(root, { all: true });
    expect(r.skippedScaffolds).toContainEqual({
      item: "Button",
      reason: "사용자가 삭제한 파일은 다시 만들지 않음 (--force로 재생성)",
    });
    expect(fs.existsSync(path.join(root, "design-system/components/Button.tsx"))).toBe(false);
    const forced = await run(root, { all: true, force: true });
    expect(forced.scaffolds.find((s) => s.name === "Button")?.status).toBe("created");
  });

  it("init.json에 outDir·updatedAt을 기록하고 가장 최근 outDir로 갱신한다", async () => {
    const root = await legacyDemo(true);
    await run(root);
    const m1 = JSON.parse(read(root, ".dsmith/init.json")) as { outDir: string; updatedAt: string };
    expect(m1.outDir).toBe("design-system");
    expect(typeof m1.updatedAt).toBe("string");
    await run(root, { outDir: "src/ds", now: new Date(2026, 10, 2) });
    const m2 = JSON.parse(read(root, ".dsmith/init.json")) as { outDir: string; updatedAt: string };
    expect(m2.outDir).toBe("src/ds");
  });

  it("리포트에 분모 범위와 알파 건수가 있고, --all 요약은 추천안 기준임을 밝힌다", async () => {
    const root = await legacyDemo(true);
    const r = await run(root, { all: true });
    const report = read(root, r.report as string);
    expect(report).toContain("분모의 범위");
    expect(report).toMatch(/전체: \d+\/\d+ \(.*\) — 알파 1건 포함/);
    expect(formatInitSummary(r)).toContain("스캐폴드는 추천안 기준");
    expect(formatInitSummary(r)).not.toContain("--all 로 추천안 사용");
  });
});

describe("runInit: 결정 뒤 재실행 (골격 재생성)", () => {
  const pickOther = async (root: string, item: string): Promise<string> => {
    const index = (await readIndex(root)) as Index;
    const record = listDecisions(index, await readDecisions(root)).find((i) => i.item === item && i.kind === "duplicate");
    const options = (record as { options: string[] }).options;
    const recommended = read(root, `design-system/components/${item}.tsx`).split("\n")[0]?.match(/추천: (.+?),/)?.[1];
    const other = options.find((o) => o !== recommended) as string;
    await chooseDecision(root, index, item, other, { kind: "duplicate" });
    return other;
  };

  it("손대지 않은 골격은 결정한 옵션 기준으로 다시 만든다(updated)", async () => {
    const root = await legacyDemo(true);
    await run(root, { all: true });
    const before = read(root, "design-system/components/Badge.tsx");
    expect(before.split("\n")[0]).toContain("결정 전");
    const other = await pickOther(root, "Badge");
    const r = await run(root);
    const badge = r.scaffolds.find((s) => s.name === "Badge");
    expect(badge).toMatchObject({ status: "updated", basis: "decided", from: other });
    const after = read(root, "design-system/components/Badge.tsx");
    expect(after.split("\n")[0]).toBe(`// dsmith init 스캐폴드 — Badge (결정: ${other})`);
    expect(after).not.toBe(before);
    expect(r.warnings).toEqual([]);
    // 한 번 더 돌려도 변하지 않는다
    expect((await run(root)).scaffolds.find((s) => s.name === "Badge")?.status).toBe("unchanged");
  });

  it("사용자가 고친 골격은 건드리지 않고, 다른 옵션 기준이라는 경고를 남긴다", async () => {
    const root = await legacyDemo(true);
    await run(root, { all: true });
    const file = path.join(root, "design-system/components/Badge.tsx");
    const mine = `${fs.readFileSync(file, "utf-8")}// 내가 구현 중\n`;
    fs.writeFileSync(file, mine);
    const other = await pickOther(root, "Badge");
    const r = await run(root);
    expect(r.scaffolds.find((s) => s.name === "Badge")?.status).toBe("skipped-exists");
    expect(fs.readFileSync(file, "utf-8")).toBe(mine);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("design-system/components/Badge.tsx");
    expect(r.warnings[0]).toContain("다른 선택지");
    expect(r.warnings[0]).toContain(other);
    expect(formatInitSummary(r)).toContain("경고: 스캐폴드 design-system/components/Badge.tsx");
    expect(read(root, r.report as string)).toContain("- 경고: 스캐폴드 design-system/components/Badge.tsx");
  });

  it("고친 골격이라도 기준 옵션이 그대로면 경고하지 않는다", async () => {
    const root = await legacyDemo(true);
    await run(root, { all: true });
    const file = path.join(root, "design-system/components/Badge.tsx");
    fs.appendFileSync(file, "// 내가 구현 중\n");
    expect((await run(root, { all: true })).warnings).toEqual([]);
  });
});

describe("runInit: 카탈로그 갱신", () => {
  const fakeCatalog = (outDir: string, tokens: unknown[] = []): string =>
    JSON.stringify({
      version: 1,
      dsmith: "0.0.0",
      sources: [{ origin: "init", dir: `${outDir}/components` }],
      components: [],
      tokens,
      stats: { components: 0, propsOk: 0, deprecated: 0, tokens: tokens.length },
    });

  it("카탈로그가 없으면 '다음: dsmith ai'를 안내한다", async () => {
    const root = await legacyDemo(true);
    const r = await run(root);
    expect(r.catalog).toBe("needs-ai");
    expect(formatInitSummary(r)).toContain("다음: dsmith ai");
    expect((await run(root, { dryRun: true })).catalog).toBeNull();
    expect(formatInitSummary(await run(root, { dryRun: true }))).not.toContain("다음: dsmith ai");
  });

  it("카탈로그가 있으면 토큰과 토큰 파일 해시를 방금 쓴 파일로 갱신하고 안내는 없다", async () => {
    const root = await legacyDemo(true);
    await run(root);
    fs.writeFileSync(path.join(root, ".dsmith/catalog.json"), fakeCatalog("design-system"));
    const r = await run(root);
    // 토큰 파일은 그대로이므로 카탈로그만 채워진다
    expect(r.catalog).toBe("refreshed");
    const catalog = JSON.parse(read(root, ".dsmith/catalog.json")) as {
      tokens: { name: string; file: string }[];
      sources: { tokenFiles?: { file: string; sha256: string }[] }[];
      stats: { tokens: number };
    };
    expect(catalog.tokens).toHaveLength(r.tokens.total);
    expect(catalog.stats.tokens).toBe(r.tokens.total);
    expect(catalog.tokens.every((t) => t.file === "design-system/tokens.json")).toBe(true);
    expect(catalog.sources[0]?.tokenFiles?.map((f) => f.file)).toEqual(["design-system/tokens.json"]);
    expect(formatInitSummary(r)).not.toContain("다음: dsmith ai");
    expect(formatInitSummary(r)).toContain("카탈로그: 토큰");
    // 같은 상태에서 다시 돌리면 그대로
    expect((await run(root)).catalog).toBe("current");
  });

  it("카탈로그가 다른 산출 디렉터리를 담고 있으면 건드리지 않고 ai를 안내한다", async () => {
    const root = await legacyDemo(true);
    await run(root);
    const stale = fakeCatalog("other");
    fs.writeFileSync(path.join(root, ".dsmith/catalog.json"), stale);
    const r = await run(root);
    expect(r.catalog).toBe("needs-ai");
    expect(read(root, ".dsmith/catalog.json")).toBe(stale);
  });
});
