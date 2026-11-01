import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COVERAGE_PROPERTIES, isRatedUsage, loadReplacementTokens, parseTsx, readIndex, replaceableToken, tokenCategoryOf } from "@dsmith-dev/core";
import { readDetect, writeDetect } from "@dsmith-dev/detect";
import type { ApplyResult, MigratePlan } from "@dsmith-dev/migrate";
import { runAudit } from "../src/commands/audit.js";
import { runDecideChoose } from "../src/commands/decide.js";
import { runInitCommand } from "../src/commands/init.js";
import { runMigrateCommand, type MigrateCommandOptions } from "../src/commands/migrate.js";
import { buildProgram } from "../src/program.js";
import { treeHash } from "./tree-hash.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const bin = path.resolve(here, "../dist/bin.js");

const tmps: string[] = [];
afterEach(() => {
  for (const t of tmps.splice(0)) fs.rmSync(t, { recursive: true, force: true });
});

interface Prepared {
  root: string;
  /** init이 보고한 커버리지(init을 실행했을 때) */
  initReplaceable: number | null;
}

/** 복사 → audit → (상태 0 강제) → (토큰 없으면) init --all → audit */
async function prepare(rel: string, opts: { overlay?: Record<string, string>; stateZero?: boolean } = {}): Promise<Prepared> {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-migrate-e2e-")));
  tmps.push(root);
  fs.cpSync(path.join(repoRoot, rel), root, { recursive: true, filter: (p) => !p.split(path.sep).includes(".dsmith") });
  for (const [file, content] of Object.entries(opts.overlay ?? {})) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  await runAudit(root);
  if (opts.stateZero === true) {
    const current = (await readDetect(root))!;
    await writeDetect(root, { ...current, overrides: { ds: { kind: "none", tokenFiles: [] }, state: 0 } });
    await runAudit(root);
  }
  const detect = (await readDetect(root))!;
  let initReplaceable: number | null = null;
  if ((await loadReplacementTokens(root, detect.ds.tokenFiles)).source === "none") {
    const { result } = await runInitCommand({ root, all: true });
    initReplaceable = result.coverage.replaceable;
    await runAudit(root);
  }
  return { root, initReplaceable };
}

type Json = { plan: MigratePlan; projected: { before: Numbers; after: Numbers } | null; applied: ApplyResult | null; actual: { before: Numbers; after: Numbers } | null };
interface Numbers {
  score: number;
  hardcodedShare: number;
  residual: Record<string, number>;
}

async function migrate(root: string, opts: Partial<MigrateCommandOptions> = {}): Promise<{ json: Json; text: string }> {
  const out = await runMigrateCommand({ root, ...opts });
  return { json: out.json as Json, text: out.text };
}

const skippedSum = (p: MigratePlan): number => Object.values(p.skipped).reduce((n, v) => n + (v ?? 0), 0);

function expectInvariants(p: MigratePlan): void {
  expect(p.planned + skippedSum(p) + p.scope.outOfRange + p.close.length).toBe(p.scope.candidates);
  expect(p.scope.candidates + p.scope.far).toBe(p.scope.total);
}

/** 후보의 정의를 테스트에서 따로 센다: hardcoded ∧ 평가 대상 ∧ 치환 대상 밖 아님 ∧ replaceableToken */
async function expectedCandidates(root: string): Promise<{ count: number; usages: string[] }> {
  const detect = (await readDetect(root))!;
  const index = (await readIndex(root))!;
  const rt = await loadReplacementTokens(root, detect.ds.tokenFiles);
  const excluded = (f: string): boolean => rt.excludeFiles.includes(f) || rt.excludeDirs.some((d) => f === d || f.startsWith(`${d}/`));
  const usages = index.styles
    .filter((u) => u.source === "hardcoded" && isRatedUsage(u) && COVERAGE_PROPERTIES.includes(u.property) && !excluded(u.file))
    .filter((u) => !(tokenCategoryOf(u.property) === "spacing" && u.normalized.kind === "length" && u.normalized.px <= 0))
    .filter((u) => replaceableToken(u, rt.tokens))
    .map((u) => `${u.file}:${u.line}:${u.column} ${u.property} ${u.raw}`);
  return { count: usages.length, usages };
}

const FIXTURES = [
  "fixtures/tailwind-app",
  "fixtures/inline-app",
  "fixtures/styled-app",
  "fixtures/emotion-app",
  "fixtures/mui-app",
  "fixtures/mixed-app",
  "fixtures/with-ds-app",
];

describe("dsmith migrate — fixture e2e", () => {
  it.each([...FIXTURES.map((f) => [f, false] as const), ["examples/legacy-demo", true] as const])(
    "%s: 후보 수는 replaceableToken 참인 사용 수와 같고 모든 후보가 계획 또는 건너뜀에 있다",
    async (rel, stateZero) => {
      const { root } = await prepare(rel, { stateZero });
      const { json } = await migrate(root);
      const { plan } = json;
      expectInvariants(plan);
      const expected = await expectedCandidates(root);
      expect(plan.scope.candidates, `테스트 후보 목록:\n${expected.usages.join("\n")}`).toBe(expected.count);
      expect(plan.tokens.source).toBe("token-file");
      // 계획만 한 레포는 바뀌지 않는다 (.dsmith 포함)
      expect(json.applied).toBeNull();
    },
    60_000,
  );

  it("legacy-demo: 후보 수 = init 커버리지의 replaceable (같은 레포·같은 토큰)", async () => {
    const { root, initReplaceable } = await prepare("examples/legacy-demo", { stateZero: true });
    const { json } = await migrate(root);
    expect(initReplaceable).not.toBeNull();
    expect(json.plan.scope.candidates).toBe(initReplaceable);
  }, 60_000);

  it("legacy-demo: --apply는 점수를 올리고 하드코딩 비율을 낮추며, 다시 계획하면 0, --revert는 트리를 되돌린다", async () => {
    const { root } = await prepare("examples/legacy-demo", { stateZero: true });
    const treeBefore = treeHash(root);
    const auditBefore = (await runAudit(root)).result.health;
    const treeWithDsmith = treeHash(root, { includeDsmith: true }); // runAudit 뒤 .dsmith까지 포함한 해시

    const planOnly = await migrate(root);
    expect(planOnly.json.plan.planned).toBeGreaterThan(0);
    expect(treeHash(root, { includeDsmith: true })).toBe(treeWithDsmith); // 계획은 읽기만 (.dsmith 포함)
    expect(treeHash(root)).toBe(treeBefore);

    const hardcodedBefore = (await expectedResidual(root)).total;
    const { json, text } = await migrate(root, { apply: true });
    const applied = json.applied!;
    expect(applied.replaced).toBeGreaterThan(0);
    expect(applied.files.every((f) => f.status === "applied")).toBe(true);
    expect(text).toMatch(/^적용: \d+개 파일 · 치환 \d+ \(되돌린 파일 0\) → 기록 \.dsmith\/migrations\/\d{8}-\d{6}\.json$/m);
    expect(text).toMatch(/^실제: 점수 \d+ → \d+, 하드코딩 비율 [\d.]+% → [\d.]+%$/m);
    expect(text).toMatch(/^리포트: \.dsmith\/reports\/migrate-\d{4}-\d{2}-\d{2}\.md$/m);
    expect(fs.existsSync(path.join(root, ".dsmith/reports", text.match(/migrate-[\d-]+\.md/)![0]))).toBe(true);

    const auditAfter = (await runAudit(root)).result.health;
    expect(auditAfter.score).toBeGreaterThan(auditBefore.score);
    expect(auditAfter.hardcodedShare).toBeLessThan(auditBefore.hardcodedShare);
    expect(json.actual!.before.score).toBe(auditBefore.score);
    expect(json.actual!.after.score).toBe(auditAfter.score);
    // 예상(계획 시점)과 실제(재audit)가 정확히 같다: 검증이 속성까지 확인해 단축 속성이 평가 대상에서 빠지는 일이 없다
    expect(json.actual!.after.hardcodedShare).toBe(json.projected!.after.hardcodedShare);
    expect(json.actual!.after.score).toBe(json.projected!.after.score);
    expect(json.actual!.before).toEqual(json.projected!.before);
    expect(json.actual!.after.residual).toEqual(json.projected!.after.residual);
    expect((await expectedResidual(root)).total).toBe(hardcodedBefore - applied.replaced);

    const again = await migrate(root);
    expect(again.json.plan.planned).toBe(0);
    expectInvariants(again.json.plan);

    const list = await migrate(root, { list: true });
    expect((list.json as unknown as { id: string; status: string }[])[0]).toMatchObject({ id: applied.id, status: "applied" });

    const reverted = await runMigrateCommand({ root, revert: applied.id });
    expect((reverted.json as { files: { status: string }[] }).files.every((f) => f.status === "reverted")).toBe(true);
    expect(treeHash(root)).toBe(treeBefore);
    expect((await runAudit(root)).result.health.score).toBe(auditBefore.score);
  }, 120_000);

  it("--files · --category · --close · --max-files", async () => {
    const { root } = await prepare("examples/legacy-demo", { stateZero: true });
    const all = (await migrate(root)).json.plan;

    const colors = (await migrate(root, { category: "color" })).json.plan;
    expectInvariants(colors);
    expect(colors.planned).toBeGreaterThan(0);
    expect(colors.byCategory.spacing + colors.byCategory.radius + colors.byCategory["font-size"]).toBe(0);
    expect(colors.planned).toBe(all.byCategory.color);

    // close는 기본에서 빠지고 --close로만 포함된다 (I4)
    expect(all.includeClose).toBe(false);
    expect(all.confidence.close).toBe(0);
    expect(all.close.length).toBeGreaterThan(0);
    const withClose = (await migrate(root, { close: true })).json.plan;
    expectInvariants(withClose);
    expect(withClose.includeClose).toBe(true);
    expect(withClose.close).toEqual([]);
    expect(withClose.confidence.close).toBe(all.close.length);
    expect(withClose.planned).toBe(all.planned + all.close.length);
    expect(withClose.scope.candidates).toBe(all.scope.candidates);

    const some = all.files.slice(0, 2).map((f) => f.file);
    const filtered = (await migrate(root, { files: some })).json.plan;
    expectInvariants(filtered);
    expect(filtered.files.map((f) => f.file)).toEqual(some);

    const limited = (await migrate(root, { maxFiles: "3" })).json.plan;
    expectInvariants(limited);
    expect(limited.files).toHaveLength(3);
    expect(limited.scope.outOfRange).toBeGreaterThan(0);

    const treeBefore = treeHash(root);
    const applied = (await migrate(root, { apply: true, maxFiles: "3", category: "color" })).json.applied!;
    expect(applied.files.length).toBeLessThanOrEqual(3);
    expect(treeHash(root)).not.toBe(treeBefore);
  }, 120_000);

  it("tailwind-app: 프리셋이 연결 안 됐으면 임의값, 연결하면 클래스명으로 치환한다", async () => {
    const { root } = await prepare("fixtures/tailwind-app");
    const unlinked = (await migrate(root)).json.plan;
    expect(unlinked.preset).toMatchObject({ linked: false });
    expect(unlinked.notes.some((n) => n.includes("연결되지 않아 임의값"))).toBe(true);
    const refs = unlinked.files.flatMap((f) => f.replacements.map((r) => r.ref));
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(ref).toMatch(/\[(color:|length:)?var\(/);

    const config = path.join(root, "tailwind.config.ts");
    fs.writeFileSync(
      config,
      fs.readFileSync(config, "utf-8").replace(
        'import type { Config } from "tailwindcss";',
        'import type { Config } from "tailwindcss";\nimport dsPreset from "./design-system/tailwind.preset";',
      ).replace("content:", "presets: [dsPreset],\n  content:"),
    );
    const linked = (await migrate(root)).json.plan;
    expect(linked.preset).toMatchObject({ linked: true });
    expect(linked.notes.some((n) => n.includes("연결되지 않아"))).toBe(false);
    const linkedRefs = linked.files.flatMap((f) => f.replacements.map((r) => r.ref));
    expect(linkedRefs.length).toBe(refs.length);
    for (const ref of linkedRefs) expect(ref).toMatch(/(^|-)ds-/);
    expectInvariants(linked);
  }, 60_000);

  it("프리셋 파일에서 손으로 지운 키는 임의값으로 폴백한다 (키는 디스크의 프리셋만 근거)", async () => {
    const { root } = await prepare("fixtures/tailwind-app");
    const config = path.join(root, "tailwind.config.ts");
    fs.writeFileSync(
      config,
      fs.readFileSync(config, "utf-8")
        .replace('import type { Config } from "tailwindcss";', 'import type { Config } from "tailwindcss";\nimport dsPreset from "./design-system/tailwind.preset";')
        .replace("content:", "presets: [dsPreset],\n  content:"),
    );
    const linked = (await migrate(root)).json.plan.files.flatMap((f) => f.replacements);
    expect(linked.every((r) => /ds-/.test(r.ref))).toBe(true);

    // 프리셋 파일에서 키 하나를 지운다
    const presetFile = path.join(root, "design-system/tailwind.preset.ts");
    const victim = linked[0]!.ref.match(/ds-[\w-]+/)![0];
    const lines = fs.readFileSync(presetFile, "utf-8").split("\n");
    const kept = lines.filter((l) => !new RegExp(`["']?${victim}["']?\\s*:`).test(l));
    expect(kept.length).toBeLessThan(lines.length);
    fs.writeFileSync(presetFile, kept.join("\n"));

    const after = (await migrate(root)).json.plan.files.flatMap((f) => f.replacements);
    const fallback = after.find((r) => r.token === linked[0]!.token && r.file === linked[0]!.file && r.line === linked[0]!.line);
    expect(fallback, "지운 키의 사용도 계획에 남아야 함").toBeDefined();
    expect(fallback!.ref).toMatch(/\[(color:|length:)?var\(/);
    expect(fallback!.ref).not.toContain(victim);
  }, 60_000);

  it("with-ds-app: 사용자 토큰 파일이 있으면 init 없이 그 토큰(var(--brand-500))으로 계획한다", async () => {
    const { root, initReplaceable } = await prepare("fixtures/with-ds-app", {
      overlay: {
        "styles/tokens.css": ":root { --brand-500: #3b82f6; --space-md: 8px; }\n",
        "src/Extra.tsx": 'export const Extra = () => <div style={{ color: "#3b82f6", padding: 8 }} />;\n',
      },
    });
    expect(initReplaceable).toBeNull();
    const { json } = await migrate(root);
    expect(json.plan.tokens.files).toEqual(["styles/tokens.css"]);
    const extra = json.plan.files.find((f) => f.file === "src/Extra.tsx")!;
    expect(extra.replacements.map((r) => r.ref).sort()).toEqual(["var(--brand-500)", "var(--space-md)"]);
    expectInvariants(json.plan);
  }, 60_000);

  it("mui-app: sx 문자열 간격이 스케일 배수면 숫자 ref로 치환한다", async () => {
    const { root } = await prepare("fixtures/mui-app", {
      overlay: { "src/Extra.tsx": 'import { Box } from "@mui/material";\nexport const Extra = () => <Box sx={{ p: "16px" }} />;\n' },
    });
    const { json } = await migrate(root);
    const extra = json.plan.files.find((f) => f.file === "src/Extra.tsx");
    expect(extra, "Extra.tsx가 계획에 있어야 함").toBeDefined();
    expect(extra!.replacements).toHaveLength(1);
    expect(extra!.replacements[0]!.ref).toMatch(/^\d+$/);
    expect(extra!.replacements[0]!.ref).toBe("2");
    expectInvariants(json.plan);
  }, 60_000);

  it("--json 모양과 --apply 없는 실행은 아무것도 쓰지 않는다 (.dsmith 포함)", async () => {
    const { root } = await prepare("fixtures/inline-app");
    const hash = treeHash(root, { includeDsmith: true });
    const result = spawnSync(process.execPath, [bin, "migrate", "--root", root, "--json"], { encoding: "utf-8" });
    expect(result.status, result.stderr).toBe(0);
    const json = JSON.parse(result.stdout) as Json;
    expect(Object.keys(json)).toEqual(["plan", "projected", "applied", "actual"]);
    expect(json.applied).toBeNull();
    expect(json.actual).toBeNull();
    expect(json.projected!.after.hardcodedShare).toBeLessThan(json.projected!.before.hardcodedShare);
    expect(Object.keys(json.plan)).toEqual(
      expect.arrayContaining(["tokens", "preset", "scope", "planned", "byCategory", "skipped", "skippedItems", "files", "components", "notes"]),
    );
    expect(treeHash(root, { includeDsmith: true })).toBe(hash);
  }, 60_000);

  it("옵션 검증: --branch는 --apply가 있어야 하고, 값 오류는 에러", async () => {
    const { root } = await prepare("fixtures/inline-app");
    await expect(runMigrateCommand({ root, branch: "x" })).rejects.toThrow("--branch는 --apply와 함께");
    await expect(runMigrateCommand({ root, category: "weight" })).rejects.toThrow("--category");
    await expect(runMigrateCommand({ root, maxFiles: "0" })).rejects.toThrow("--max-files");
    await expect(runMigrateCommand({ root, apply: true, revert: "x" })).rejects.toThrow("함께 쓸 수 없습니다");
  }, 60_000);

  it("옵션이 등록돼 있다", () => {
    const cmd = buildProgram().commands.find((c) => c.name() === "migrate");
    expect(cmd?.options.map((o) => o.long).sort()).toEqual(
      ["--apply", "--branch", "--category", "--close", "--files", "--json", "--list", "--max-files", "--only", "--revert", "--root"].sort(),
    );
  });
});

const DS_BUTTON = "src/components/ui/button";
const OLD_PAGE = "app/orders/page.tsx";
const BUTTON_MAP = { "variant=secondary": "variant=outline", "variant=danger": "variant=destructive" };

describe("dsmith migrate — 결정 기반 컴포넌트 치환 (legacy-demo)", () => {
  const parseErrors = (root: string, file: string): number => (parseTsx(fs.readFileSync(path.join(root, file), "utf-8"), file).errors ?? []).length;

  it("결정 전에는 pending만 세고 파일은 바뀌지 않는다; props 차이는 mapping 없으면 보류, 주면 편집한다", async () => {
    const { root } = await prepare("examples/legacy-demo", { stateZero: true });
    const tree = treeHash(root, { includeDsmith: true });

    const pending = (await migrate(root, { only: "components" })).json.plan;
    expect(pending.components).toMatchObject({ decided: 0, imports: 0, props: 0, pending: 2, held: { "decision-pending": 4 } });
    expect(pending.componentPending.map((p) => p.item).sort()).toEqual(["Badge", "Button"]);
    expect(pending.files).toEqual([]);

    await runDecideChoose(root, "Button", DS_BUTTON);
    const heldPlan = (await migrate(root, { only: "components" })).json.plan;
    expect(heldPlan.files).toEqual([]);
    expect(heldPlan.components).toMatchObject({ decided: 1, imports: 0, pending: 1 });
    expect(heldPlan.components.held["mapping-missing"]).toBe(1);
    expect(heldPlan.componentHeld[0]).toMatchObject({ item: "Button", file: OLD_PAGE, reason: "mapping-missing" });
    expect(heldPlan.componentHeld[0]?.detail).toContain('variant="secondary"');
    expect(heldPlan.componentHeld[0]?.detail).toContain('variant="danger"');

    await runDecideChoose(root, "Button", DS_BUTTON, undefined, { mapping: BUTTON_MAP });
    const { json, text } = await migrate(root, { only: "components" });
    expect(json.plan.components).toMatchObject({ decided: 1, files: 1, imports: 1, props: 3, annotations: 0 });
    expect(json.plan.files.map((f) => f.file)).toEqual([OLD_PAGE]);
    expect(text).toContain("컴포넌트: 결정 1건 → 파일 1 · import 1 · prop 3");
    expect(text).toContain("결정 대기 Badge");
    // 계획만으로는 아무것도 쓰지 않는다(.dsmith 포함, decisions는 위에서 이미 쓴 뒤)
    const afterDecide = treeHash(root, { includeDsmith: true });
    await migrate(root, { only: "components" });
    expect(treeHash(root, { includeDsmith: true })).toBe(afterDecide);
    expect(afterDecide).not.toBe(tree);
  }, 120_000);

  it("--apply --only components: import가 DS module로 가고 타입 오류가 늘지 않으며 재audit에서 중복 Button 사용처가 DS module뿐이다", async () => {
    const { root } = await prepare("examples/legacy-demo", { stateZero: true });
    await runDecideChoose(root, "Button", DS_BUTTON, undefined, { mapping: BUTTON_MAP });
    const errorsBefore = parseErrors(root, OLD_PAGE);
    const tokensOnlyHash = treeHash(root);

    const { json, text } = await migrate(root, { apply: true, only: "components" });
    expect(json.applied).toMatchObject({ replaced: 0, components: 1, props: 3, annotations: 0, componentsRolledBack: 0 });
    expect(text).toMatch(/^적용: 1개 파일 · 치환 0 · 컴포넌트 import 1 · prop 3 \(되돌린 파일 0\) → 기록 /m);
    const page = fs.readFileSync(path.join(root, OLD_PAGE), "utf-8");
    expect(page).toContain('import { Button } from "@/components/ui/button";');
    expect(page).not.toContain("src/components/Button");
    expect(page).toContain('<Button variant="outline" size="sm">');
    expect(page.match(/variant="destructive"/g)).toHaveLength(2);
    expect(parseErrors(root, OLD_PAGE)).toBeLessThanOrEqual(errorsBefore);
    // 정의는 지우지 않는다
    expect(fs.existsSync(path.join(root, "src/components/Button.tsx"))).toBe(true);
    expect(treeHash(root)).not.toBe(tokensOnlyHash);

    await runAudit(root);
    const index = (await readIndex(root))!;
    expect([...new Set(index.components.filter((c) => c.name === "Button").map((c) => c.module))]).toEqual([DS_BUTTON]);

    // Badge는 여전히 pending
    const again = (await migrate(root, { only: "components" })).json.plan;
    expect(again.components).toMatchObject({ decided: 1, imports: 0, props: 0, pending: 1 });
    expect(again.files).toEqual([]);
  }, 120_000);

  it("--only tokens는 컴포넌트를 건드리지 않고, 기본(둘 다) 적용 뒤 --revert는 트리를 되돌린다", async () => {
    const { root } = await prepare("examples/legacy-demo", { stateZero: true });
    await runDecideChoose(root, "Button", DS_BUTTON, undefined, { mapping: BUTTON_MAP });
    const treeBefore = treeHash(root);

    const tokensOnly = await migrate(root, { only: "tokens" });
    expect(tokensOnly.json.plan.components).toMatchObject({ decided: 0, imports: 0, pending: 0 });
    expect(tokensOnly.json.plan.files.every((f) => f.components.length === 0)).toBe(true);

    const both = await migrate(root, { apply: true });
    const applied = both.json.applied!;
    expect(applied.components).toBe(1);
    expect(applied.files.every((f) => f.status === "applied")).toBe(true);
    expect(fs.readFileSync(path.join(root, OLD_PAGE), "utf-8")).toContain('from "@/components/ui/button"');
    const report = fs.readFileSync(path.join(root, ".dsmith/reports", both.text.match(/migrate-[\d-]+\.md/)![0]), "utf-8");
    expect(report).toContain("## 컴포넌트");
    expect(report).toContain("import 1 · prop 3");

    await runMigrateCommand({ root, revert: applied.id });
    expect(treeHash(root)).toBe(treeBefore);
  }, 180_000);
});

/** 계획 범위(토큰 파일 제외)의 남은 hardcoded 대상 사용 수 */
async function expectedResidual(root: string): Promise<{ total: number }> {
  const detect = (await readDetect(root))!;
  const index = (await readIndex(root))!;
  const rt = await loadReplacementTokens(root, detect.ds.tokenFiles);
  const excluded = (f: string): boolean => rt.excludeFiles.includes(f) || rt.excludeDirs.some((d) => f === d || f.startsWith(`${d}/`));
  const total = index.styles.filter(
    (u) =>
      u.source === "hardcoded" &&
      isRatedUsage(u) &&
      COVERAGE_PROPERTIES.includes(u.property) &&
      !excluded(u.file) &&
      !(tokenCategoryOf(u.property) === "spacing" && u.normalized.kind === "length" && u.normalized.px <= 0),
  ).length;
  return { total };
}

describe("dsmith migrate --apply --branch", () => {
  const ENV_KEYS = ["HOME", "GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_GLOBAL", "XDG_CONFIG_HOME", "EMAIL", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"];
  const savedEnv: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-branch-home-"));
    tmps.push(home);
    process.env.HOME = home;
    process.env.XDG_CONFIG_HOME = path.join(home, ".config");
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    process.env.GIT_CONFIG_GLOBAL = path.join(home, "nope");
    for (const k of ["EMAIL", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"]) delete process.env[k];
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  const git = (cwd: string, ...args: string[]): string =>
    spawnSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.com", ...args], { cwd, encoding: "utf-8" }).stdout;

  /** legacy-demo(상태 0) + Button 결정 → git 레포(.dsmith는 무시)로 만들어 커밋한다 */
  async function gitRepo(identity: boolean): Promise<string> {
    const { root } = await prepare("examples/legacy-demo", { stateZero: true });
    await runDecideChoose(root, "Button", DS_BUTTON, undefined, { mapping: BUTTON_MAP });
    fs.writeFileSync(path.join(root, ".gitignore"), ".dsmith/\n");
    git(root, "init", "-q", "-b", "main");
    git(root, "add", ".");
    git(root, "commit", "-q", "-m", "init");
    if (identity) {
      git(root, "config", "user.name", "Repo Author");
      git(root, "config", "user.email", "repo@example.com");
    } else {
      git(root, "config", "user.useConfigOnly", "true");
    }
    return root;
  }

  it("브랜치를 만들어 적용 파일만 커밋한다(.dsmith 제외, 작성자는 레포 설정), push·PR은 없다", async () => {
    const root = await gitRepo(true);
    const baseSha = git(root, "rev-parse", "HEAD").trim();
    const { json, text, exitCode } = await runMigrateCommand({ root, apply: true, branch: "ds/migrate-test" });
    expect(exitCode).toBe(0);
    expect(git(root, "branch", "--show-current").trim()).toBe("ds/migrate-test");
    const applied = (json as Json).applied!;
    const sha = git(root, "rev-parse", "HEAD").trim();
    expect(text).toContain(`브랜치 ds/migrate-test에 커밋 ${sha.slice(0, 7)} — PR은 직접 여세요`);
    expect(git(root, "log", "-1", "--format=%s%n%an <%ae>").trim()).toBe(
      `chore(ds): 하드코딩 ${applied.replaced}건을 토큰으로, 컴포넌트 import ${applied.components}건을 DS로 치환 (dsmith migrate)\nRepo Author <repo@example.com>`,
    );
    const committed = git(root, "show", "--name-only", "--format=", "HEAD").trim().split("\n").sort();
    expect(committed).toEqual(applied.files.filter((f) => f.status === "applied").map((f) => f.file).sort());
    expect(committed.some((f) => f.startsWith(".dsmith"))).toBe(false);
    expect(git(root, "status", "--porcelain").trim()).toBe("");
    expect(git(root, "remote").trim()).toBe("");
    const record = JSON.parse(fs.readFileSync(path.join(root, applied.record), "utf-8"));
    expect(record.branch).toEqual({ name: "ds/migrate-test", base: "main", baseSha, commit: sha });
    expect((json as { branch: { commit: string } }).branch.commit).toBe(sha);
  }, 180_000);

  it("git 식별 정보가 없으면 아무것도 쓰기 전에 오류이고 트리·브랜치가 그대로다", async () => {
    const root = await gitRepo(false);
    const tree = treeHash(root, { includeDsmith: true });
    await expect(runMigrateCommand({ root, apply: true, branch: "ds/migrate-test" })).rejects.toThrow(/--branch를 쓸 수 없음: git 작성자 정보가 없음/);
    expect(treeHash(root, { includeDsmith: true })).toBe(tree);
    expect(git(root, "branch", "--list", "ds/migrate-test").trim()).toBe("");
    expect(git(root, "branch", "--show-current").trim()).toBe("main");
  }, 120_000);

  it("같은 이름의 브랜치가 있거나 대상 파일이 dirty면 오류, 쓰지 않는다", async () => {
    const root = await gitRepo(true);
    git(root, "branch", "ds/taken");
    const tree = treeHash(root, { includeDsmith: true });
    await expect(runMigrateCommand({ root, apply: true, branch: "ds/taken" })).rejects.toThrow("이미 있음");
    expect(treeHash(root, { includeDsmith: true })).toBe(tree);

    fs.appendFileSync(path.join(root, OLD_PAGE), "\n// dirty\n");
    const dirtyTree = treeHash(root, { includeDsmith: true });
    await expect(runMigrateCommand({ root, apply: true, branch: "ds/new" })).rejects.toThrow(/커밋하지 않은 변경.*orders\/page\.tsx/);
    expect(treeHash(root, { includeDsmith: true })).toBe(dirtyTree);
    expect(git(root, "branch", "--list", "ds/new").trim()).toBe("");
  }, 120_000);

  it("계획이 0건이면 브랜치를 만들지 않는다", async () => {
    const { root } = await prepare("examples/legacy-demo", { stateZero: true });
    git(root, "init", "-q", "-b", "main");
    // 컴포넌트 결정이 없고 --only components라 편집이 없다
    const out = await runMigrateCommand({ root, apply: true, branch: "ds/none", only: "components" });
    expect(out.text).toContain("적용할 치환이 없음");
    expect(git(root, "branch", "--list", "ds/none").trim()).toBe("");
  }, 120_000);
});

describe("dsmith migrate — 리뷰 수정 (C1 · I1 · I3 · I4 · I5, legacy-demo)", () => {
  const MODAL = "src/components/Modal.tsx";

  it("C1: Modal의 반투명 backdrop(rgba(17, 24, 39, 0.5))은 translucent-color로 건너뛰고 파일에 그대로 남는다", async () => {
    const { root } = await prepare("examples/legacy-demo", { stateZero: true });
    const modalBefore = fs.readFileSync(path.join(root, MODAL), "utf-8");
    expect(modalBefore).toContain("rgba(17, 24, 39, 0.5)");
    const { json } = await migrate(root, { close: true });
    const skip = json.plan.skippedItems.find((i) => i.file === MODAL && i.reason === "translucent-color");
    expect(skip, JSON.stringify(json.plan.skippedItems)).toBeDefined();
    expect(skip!.raw).toBe("rgba(17, 24, 39, 0.5)");
    expect(json.plan.files.flatMap((f) => f.replacements).some((r) => r.raw.includes("rgba"))).toBe(false);

    await migrate(root, { apply: true, close: true });
    expect(fs.readFileSync(path.join(root, MODAL), "utf-8")).toContain("rgba(17, 24, 39, 0.5)");
  }, 120_000);

  it("I4: 기본은 identical·exact만 적용하고 close 후보는 plan.close에 남는다; --close를 주면 포함하고 기록에 남는다", async () => {
    const { root } = await prepare("examples/legacy-demo", { stateZero: true });
    const treeBefore = treeHash(root);
    const base = await migrate(root);
    expect(base.json.plan.confidence.close).toBe(0);
    expect(base.json.plan.close.length).toBeGreaterThan(0);
    expect(base.json.plan.close[0]).toMatchObject({ token: expect.any(String), value: expect.any(String), distance: expect.any(Number) });
    expect(base.text).toContain(`close 후보 ${base.json.plan.close.length}건 — --close로 포함`);

    const first = await migrate(root, { apply: true });
    const record = JSON.parse(fs.readFileSync(path.join(root, first.json.applied!.record), "utf-8")) as { close: boolean };
    expect(record.close).toBe(false);
    // 적용한 것 가운데 close는 없고, 남은 close 후보는 그대로다
    const afterBase = (await migrate(root)).json.plan;
    expect(afterBase.planned).toBe(0);
    expect(afterBase.close.length).toBe(base.json.plan.close.length);

    // --close: 남은 close 후보를 포함해 적용한다. 같은 날 두 번째 리포트는 -2가 붙어 덮어쓰지 않는다 (M5)
    const second = await migrate(root, { apply: true, close: true });
    expect(second.json.applied!.replaced).toBe(base.json.plan.close.length);
    const record2 = JSON.parse(fs.readFileSync(path.join(root, second.json.applied!.record), "utf-8")) as { close: boolean };
    expect(record2.close).toBe(true);
    const reports = fs.readdirSync(path.join(root, ".dsmith/reports")).filter((f) => f.startsWith("migrate-")).sort();
    expect(reports).toHaveLength(2);
    const second2 = reports.find((f) => /-2\.md$/.test(f));
    expect(second2).toMatch(/^migrate-\d{4}-\d{2}-\d{2}-2\.md$/);
    expect(second.text).toContain(`리포트: .dsmith/reports/${second2}`);

    await runMigrateCommand({ root, revert: second.json.applied!.id });
    await runMigrateCommand({ root, revert: first.json.applied!.id });
    expect(treeHash(root)).toBe(treeBefore);
  }, 180_000);

  it("I3: audit 뒤 파일을 고쳐도 예상은 실제와 정확히 같고, 낡은 인덱스 경고가 나온다", async () => {
    const { root } = await prepare("examples/legacy-demo", { stateZero: true });
    const clean = await migrate(root);
    expect(clean.text).not.toContain("인덱스가 오래됨");
    const edited = clean.json.plan.files.slice(0, 2).map((f) => f.file);
    for (const f of edited) {
      const abs = path.join(root, f);
      fs.writeFileSync(abs, `${f.endsWith(".css") ? "/* 줄이 밀림 */" : "// 줄이 밀림"}\n${fs.readFileSync(abs, "utf-8")}`);
    }
    await new Promise((r) => setTimeout(r, 20));
    fs.writeFileSync(path.join(root, "src/components/NewBox.tsx"), 'export const NewBox = () => <div style={{ padding: 16, color: "#111827" }} />;\n');

    const { json, text } = await migrate(root, { apply: true });
    expect(text).toContain("인덱스가 오래됨: 3개 파일이 audit 이후 바뀜(인덱스에 없던 새 파일 1개 포함) — dsmith audit을 다시 실행하세요");
    expect(json.plan.stale.changed).toEqual([...edited].sort());
    expect(json.plan.stale.added).toEqual(["src/components/NewBox.tsx"]);
    expect(json.applied!.files.every((f) => f.status === "applied")).toBe(true);
    const actual = json.actual!;
    expect(actual.after.hardcodedShare).toBe(json.projected!.after.hardcodedShare);
    expect(actual.after.score).toBe(json.projected!.after.score);
    // "전"도 낡은 인덱스가 아니라 디스크 기준이다: 편집한 파일을 포함한 재계산과 같다
    const reAudit = (await runAudit(root)).result.health;
    expect(actual.after.score).toBe(reAudit.score);
    expect(actual.after.hardcodedShare).toBe(reAudit.hardcodedShare);
  }, 180_000);

  it("I5: --revert에서 적용 뒤 수정된 파일이 있으면 종료 코드 1, 깨끗하면 0(설정 안 함)", async () => {
    const { root } = await prepare("examples/legacy-demo", { stateZero: true });
    const applied = (await migrate(root, { apply: true })).json.applied!;
    expect((await runMigrateCommand({ root, apply: false, list: true })).exitCode).toBeUndefined();
    const victim = applied.files[0]!.file;
    fs.appendFileSync(path.join(root, victim), "\n// 적용 뒤 손으로 고침\n");
    const partial = await runMigrateCommand({ root, revert: applied.id });
    expect(partial.exitCode).toBe(1);
    expect(partial.text).toContain(`${victim}: skipped-modified`);
    expect((partial.json as { files: { file: string; status: string }[] }).files.find((f) => f.file === victim)?.status).toBe("skipped-modified");

    // 고친 파일을 원래 적용 결과로 되돌려 놓으면 revert는 깨끗이 끝난다
    const clean = await prepare("examples/legacy-demo", { stateZero: true });
    const appliedClean = (await migrate(clean.root, { apply: true })).json.applied!;
    const ok = await runMigrateCommand({ root: clean.root, revert: appliedClean.id });
    expect(ok.exitCode).toBeUndefined();
  }, 180_000);

  it("--json 계획에 close·includeClose·stale이 있다", async () => {
    const { root } = await prepare("fixtures/inline-app");
    const result = spawnSync(process.execPath, [bin, "migrate", "--root", root, "--json"], { encoding: "utf-8" });
    expect(result.status, result.stderr).toBe(0);
    const json = JSON.parse(result.stdout) as Json;
    expect(Object.keys(json.plan)).toEqual(expect.arrayContaining(["includeClose", "close", "stale"]));
    expect(json.plan.stale).toEqual({ changed: [], added: [] });
  }, 60_000);
});
