import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Linter } from "eslint";
import dsmithPlugin from "@dsmith-dev/eslint-plugin";
import { readDetect, writeDetect } from "@dsmith-dev/detect";
import { runAudit } from "../src/commands/audit.js";
import { runInitCommand } from "../src/commands/init.js";
import { treeHash } from "./tree-hash.js";

/**
 * migrate → guard 전 구간(legacy-demo): audit → init → migrate(계획·적용·브랜치 커밋) → guard init → guard --ci → ESLint → revert.
 * 같은 규칙 엔진이 migrate 후보·guard 신규 판정·ESLint 보고에 쓰인다는 것과, 사람용 출력·--json·리포트 파일의 숫자가 하나라는 것을 고정한다.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const bin = path.resolve(here, "../dist/bin.js");

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };
const git = (root: string, ...args: string[]): string => execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf-8", env: GIT_ENV });
const dsmith = (root: string, ...args: string[]) => spawnSync(process.execPath, [bin, ...args], { cwd: root, encoding: "utf-8", env: GIT_ENV });
const dsmithJson = <T>(root: string, ...args: string[]): { status: number | null; json: T; stderr: string } => {
  const r = dsmith(root, ...args, "--json");
  return { status: r.status, json: JSON.parse(r.stdout) as T, stderr: r.stderr };
};

interface PlanJson {
  planned: number;
  files: { file: string; replacements: { patch: { start: number } }[] }[];
  skipped: Record<string, number>;
  close: unknown[];
  scope: { candidates: number; outOfRange: number };
  includeClose: boolean;
}
interface Numbers {
  score: number;
  hardcodedShare: number;
}
interface MigrateJson {
  plan: PlanJson;
  projected: { before: Numbers; after: Numbers } | null;
  applied: { id: string; replaced: number; files: { file: string; status: string }[] } | null;
  actual: { before: Numbers; after: Numbers } | null;
  branch: { name: string; base: string; commit: string | null } | null;
}
interface GuardJson {
  counts: { newHardcoded: number; newReplaceable: number; newNonDs: number; newDeprecated: number; removedHardcoded: number };
  exitCode: number;
  files: string[];
  newFindings: { rule: string; file: string; line: number; style?: { property: string; raw: string } }[];
  staleSnapshot: string[];
}

const sum = (o: Record<string, number>): number => Object.values(o).reduce((n, v) => n + v, 0);
const num = (text: string, re: RegExp): number => {
  const m = re.exec(text);
  if (m?.[1] === undefined) throw new Error(`패턴 없음: ${re} in\n${text}`);
  return Number(m[1]);
};

const tmps: string[] = [];
function tmpDir(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmps.push(dir);
  return dir;
}

const state: {
  root: string;
  auditScoreBefore: number;
  initReplaceable: number;
  planText: string;
  planJson: MigrateJson;
  applyJson: MigrateJson;
  applyStatus: number | null;
  report: string;
  auditAfter: { score: number; hardcodedShare: number };
  auditBefore: { score: number; hardcodedShare: number };
  guardClean: GuardJson;
  guardCleanStatus: number | null;
  guardDirty: GuardJson;
  guardDirtyStatus: number | null;
  mainSha: string;
  branchCommits: number;
  currentBranch: string;
  pageSource: string;
  pageSourceBefore: string;
  revert: { humanApply: string; revertStatus: number | null; treeBefore: string; treeAfter: string; treeApplied: string; reportAfterApply: string; revertOut: string };
} = {} as never;

beforeAll(async () => {
  const root = tmpDir("dsmith-e2e-mg-");
  state.root = root;
  fs.cpSync(path.join(repoRoot, "examples/legacy-demo"), root, { recursive: true, filter: (p) => !p.split(path.sep).includes(".dsmith") });
  // legacy-demo에는 .tsx가 있어 guard init이 설정을 고치려면 TS 파서가 설정에 보여야 한다. .dsmith는 guard.json만 추적한다
  fs.writeFileSync(path.join(root, "eslint.config.mjs"), 'import tseslint from "typescript-eslint";\n\nexport default [\n  tseslint.configs.base,\n  { rules: {} },\n];\n');
  fs.writeFileSync(path.join(root, ".gitignore"), ".dsmith/*\n!.dsmith/guard.json\n");
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "Dahee Hwang");
  git(root, "config", "user.email", "dahee@project-hh.com");

  // audit → 기존 스냅샷의 점수
  const first = (await runAudit(root)).result.health;
  state.auditScoreBefore = first.score;
  state.auditBefore = { score: first.score, hardcodedShare: first.hardcodedShare };

  // 상태 0 → init --all → audit
  const current = (await readDetect(root))!;
  await writeDetect(root, { ...current, overrides: { ds: { kind: "none", tokenFiles: [] }, state: 0 } });
  await runAudit(root);
  const { result: init } = await runInitCommand({ root, all: true });
  state.initReplaceable = init.coverage.replaceable;
  const reaudit = (await runAudit(root)).result.health;
  state.auditBefore = { score: reaudit.score, hardcodedShare: reaudit.hardcodedShare };

  // 계획(아무것도 쓰지 않는다): 사람용 출력과 --json
  const human = dsmith(root, "migrate");
  expect(human.status).toBe(0);
  state.planText = human.stdout;
  state.planJson = dsmithJson<MigrateJson>(root, "migrate").json;

  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  state.mainSha = git(root, "rev-parse", "HEAD").trim();

  // 별도 복사본(.git 없이) — 적용 → 되돌리기 → 트리 해시 비교는 아래에서
  const copy = tmpDir("dsmith-e2e-mg-copy-");
  fs.cpSync(root, copy, { recursive: true, filter: (p) => !p.split(path.sep).includes(".git") });
  const treeBefore = treeHash(copy);
  const humanApply = dsmith(copy, "migrate", "--apply");
  const treeApplied = treeHash(copy);
  const id = /기록 \.dsmith\/migrations\/([\w-]+)\.json/.exec(humanApply.stdout)?.[1] ?? "";
  const reportName = fs.readdirSync(path.join(copy, ".dsmith/reports")).find((f) => f.startsWith("migrate-")) ?? "";
  const reportAfterApply = reportName === "" ? "" : fs.readFileSync(path.join(copy, ".dsmith/reports", reportName), "utf-8");
  const rev = dsmith(copy, "migrate", "--revert", id);
  state.revert = { humanApply: humanApply.stdout, revertStatus: rev.status, treeBefore, treeApplied, treeAfter: treeHash(copy), reportAfterApply, revertOut: rev.stdout };

  // 적용: 브랜치에 커밋 1개
  const applied = dsmithJson<MigrateJson>(root, "migrate", "--apply", "--branch", "ds/migrate-tokens");
  state.applyJson = applied.json;
  state.applyStatus = applied.status;
  const reportFile = fs.readdirSync(path.join(root, ".dsmith/reports")).find((f) => f.startsWith("migrate-")) ?? "";
  state.report = fs.readFileSync(path.join(root, ".dsmith/reports", reportFile), "utf-8");
  state.currentBranch = git(root, "branch", "--show-current").trim();
  state.branchCommits = Number(git(root, "rev-list", "--count", "main..ds/migrate-tokens").trim());
  const after = (await runAudit(root)).result.health;
  state.auditAfter = { score: after.score, hardcodedShare: after.hardcodedShare };

  // guard init → 커밋 → guard --ci (마이그레이션 PR은 하드코딩을 줄이기만 한다)
  expect(dsmith(root, "guard", "init").status).toBe(0);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "guard");
  const clean = dsmithJson<GuardJson>(root, "guard", "--ci", "--base", "main");
  state.guardClean = clean.json;
  state.guardCleanStatus = clean.status;

  // 새 하드코딩 한 줄
  const page = path.join(root, "app/page.tsx");
  const src = fs.readFileSync(page, "utf-8");
  const edited = src.replace('<div className="space-y-6">\n', '<div className="space-y-6">\n      <p style={{ color: "#e11d48" }}>주의</p>\n');
  expect(edited).not.toBe(src);
  fs.writeFileSync(page, edited);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "warn");
  const dirty = dsmithJson<GuardJson>(root, "guard", "--ci", "--base", "main");
  state.guardDirty = dirty.json;
  state.guardDirtyStatus = dirty.status;
  state.pageSource = edited;
  state.pageSourceBefore = src;
}, 240_000);

afterAll(() => {
  for (const t of tmps) fs.rmSync(t, { recursive: true, force: true });
});

describe("legacy-demo 전 구간: init → migrate → guard", () => {
  it("audit 점수는 기존 스냅샷의 52", () => {
    expect(state.auditScoreBefore).toBe(52);
  });

  it("migrate 계획: 후보 = init 커버리지 replaceable, 불변식 planned + Σskipped + outOfRange + close = candidates", () => {
    const { plan } = state.planJson;
    expect(plan.scope.candidates).toBe(state.initReplaceable);
    expect(plan.planned + sum(plan.skipped) + plan.scope.outOfRange + plan.close.length).toBe(plan.scope.candidates);
    expect(plan.includeClose).toBe(false); // 기본은 같은 값·exact만, close는 건수만
    expect(plan.planned).toBeGreaterThan(0);
    expect(state.planJson.applied).toBeNull();
  });

  it("사람용 계획 출력의 숫자 = --json 값", () => {
    const { plan } = state.planJson;
    expect(num(state.planText, /계획: 파일 (\d+)/)).toBe(plan.files.length);
    expect(num(state.planText, /계획: 파일 \d+ · 치환 (\d+)/)).toBe(plan.planned);
    expect(num(state.planText, /후보 (\d+) =/)).toBe(plan.scope.candidates);
    expect(num(state.planText, /close 후보 (\d+)건/)).toBe(plan.close.length);
    expect(state.planText).toContain(`점수 ${state.planJson.projected?.before.score} → ${state.planJson.projected?.after.score}`);
  });

  it("--apply --branch: 브랜치에 커밋 1개, 점수↑·하드코딩 비율↓", () => {
    expect(state.applyStatus).toBe(0);
    expect(state.currentBranch).toBe("ds/migrate-tokens");
    expect(state.branchCommits).toBe(1);
    expect(state.applyJson.branch?.name).toBe("ds/migrate-tokens");
    expect(state.applyJson.branch?.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(state.applyJson.applied?.files.every((f) => f.status === "applied")).toBe(true);
    expect(state.applyJson.applied?.replaced).toBe(state.planJson.plan.planned);
    // 독립적으로 다시 audit한 값 = migrate가 보고한 실제 값, 예상과도 같다
    expect(state.auditAfter.score).toBeGreaterThan(state.auditScoreBefore);
    expect(state.auditAfter.hardcodedShare).toBeLessThan(state.auditBefore.hardcodedShare);
    expect(state.applyJson.actual?.after.score).toBe(state.auditAfter.score);
    expect(state.applyJson.actual?.after.hardcodedShare).toBe(state.auditAfter.hardcodedShare);
    expect(state.applyJson.actual?.after.score).toBe(state.planJson.projected?.after.score);
  });

  it("리포트 파일의 숫자 = --json 값", () => {
    const applied = state.applyJson.applied!;
    expect(state.report).toContain(`적용: ${applied.files.length}개 파일 · 치환 ${applied.replaced}`);
    expect(state.report).toContain(`| 점수 | ${state.applyJson.actual?.before.score} | ${state.applyJson.actual?.after.score} |`);
    expect(state.report).toContain(`close 후보 ${state.planJson.plan.close.length}건은 계획에서 제외`);
  });

  it("guard --ci: 마이그레이션 브랜치는 신규 하드코딩 0건·종료 코드 0, 줄어든 수는 적용 치환 수 − 같은 위치 중복 추출", () => {
    expect(state.guardCleanStatus).toBe(0);
    expect(state.guardClean.exitCode).toBe(0);
    expect(state.guardClean.counts.newHardcoded).toBe(0);
    expect(state.guardClean.staleSnapshot).toEqual([]);
    // 같은 소스 위치(patch.start)를 두 번 센 것은 guard가 한 번만 센다
    const replacements = state.planJson.plan.files.flatMap((f) => f.replacements.map((r) => `${f.file}:${r.patch.start}`));
    const unique = new Set(replacements).size;
    expect(replacements.length).toBe(state.applyJson.applied?.replaced);
    expect(state.guardClean.counts.removedHardcoded).toBe(unique);
  });

  it("app/page.tsx에 style={{ color }}를 더하면 guard --ci는 신규 1건·종료 코드 1", () => {
    expect(state.guardDirtyStatus).toBe(1);
    expect(state.guardDirty.exitCode).toBe(1);
    expect(state.guardDirty.counts.newHardcoded).toBe(1);
    const [finding] = state.guardDirty.newFindings;
    expect(finding?.rule).toBe("no-hardcoded-style");
    expect(finding?.file).toBe("app/page.tsx");
    expect(finding?.style?.property).toBe("color");
  });

  it("같은 파일을 ESLint(Linter + configs.recommended)로 검사하면 새로 더한 줄이 dsmith/no-hardcoded-style 1건 — 같은 엔진", () => {
    const lint = (code: string) => {
      const messages = new Linter({ configType: "flat", cwd: state.root }).verify(
        code,
        [{ ...dsmithPlugin.configs.recommended, languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } }],
        { filename: path.join(state.root, "app/page.tsx") },
      );
      expect(messages.filter((m) => m.fatal === true)).toEqual([]);
      return messages.filter((m) => m.ruleId?.startsWith("dsmith/"));
    };
    // 이 파일에는 migrate 기본(같은 값·exact)이 건드리지 않은 close 후보 2건(margin·gap)이 원래 있다.
    // ESLint는 파일 전체를 보고하고 guard는 base 대비 신규만 센다 — 둘의 차이는 새로 더한 줄 1건이다.
    const before = lint(state.pageSourceBefore);
    const after = lint(state.pageSource);
    expect(before.every((m) => m.ruleId === "dsmith/no-hardcoded-style")).toBe(true);
    expect(after).toHaveLength(before.length + 1);
    const added = after.filter((m) => m.message.includes("#e11d48"));
    expect(added).toHaveLength(1);
    expect(added[0]?.ruleId).toBe("dsmith/no-hardcoded-style");
    expect(added[0]?.message).toContain("color");
    expect(added[0]?.line).toBe(state.guardDirty.newFindings[0]?.line);
    expect(after.length - before.length).toBe(state.guardDirty.counts.newHardcoded);
  });

  it("별도 복사본: --apply → --revert 뒤 트리 해시(.dsmith 제외)가 적용 전과 같고, 적용 출력·리포트 숫자는 --json과 같다", () => {
    const r = state.revert;
    expect(r.treeApplied).not.toBe(r.treeBefore);
    expect(r.revertStatus).toBe(0);
    expect(r.treeAfter).toBe(r.treeBefore);
    expect(r.revertOut).toContain("되돌린 파일");
    const applied = state.applyJson.applied!;
    expect(num(r.humanApply, /적용: (\d+)개 파일/)).toBe(applied.files.length);
    expect(num(r.humanApply, /적용: \d+개 파일 · 치환 (\d+)/)).toBe(applied.replaced);
    expect(r.reportAfterApply).toContain(`적용: ${applied.files.length}개 파일 · 치환 ${applied.replaced}`);
  });

  it("main은 그대로 — 마이그레이션은 브랜치에만 있다", () => {
    expect(git(state.root, "rev-parse", "main").trim()).toBe(state.mainSha);
  });
});
