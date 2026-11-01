import fs from "node:fs/promises";
import path from "node:path";
import {
  atomicWrite,
  listMigrations,
  localDate,
  readIndex,
  readMigration,
  writeMigration,
  type Index,
  type MigrationRecord,
  type Token,
} from "@dsmith-dev/core";
import { readDetect, type DetectResult } from "@dsmith-dev/detect";
import {
  abandonBranch,
  analyzeMigration,
  applyMigration,
  checkBranch,
  commitFiles,
  commitMessage,
  createBranch,
  formatPlanSummary,
  planExcludes,
  projectComponents,
  projectStyles,
  withFreshStyles,
  renderMigrateReport,
  residualByCategory,
  revertMigration,
  pct,
  type ApplyResult,
  type AuditNumbers,
  type MigratePlan,
  type RevertResult,
} from "@dsmith-dev/migrate";
import { buildExtractors } from "../registry.js";
import { cliVersion } from "../version.js";
import { computeAudit, runAudit } from "./audit.js";

export interface MigrateCommandOptions {
  root: string;
  json?: boolean | undefined;
  files?: string[] | undefined;
  category?: string | undefined;
  only?: string | undefined;
  /** close(근사) 매칭도 계획·적용에 포함 */
  close?: boolean | undefined;
  maxFiles?: string | undefined;
  apply?: boolean | undefined;
  branch?: string | undefined;
  /** --branch 커밋에 untracked·수정된 토큰·프리셋 파일도 넣는다 */
  withTokens?: boolean | undefined;
  revert?: string | undefined;
  list?: boolean | undefined;
}

export interface MigrateOutput {
  /** `--json`일 때 stdout에 쓸 값 */
  json: unknown;
  /** 사람용 출력 */
  text: string;
  /** 종료 코드: 적용하지 못한 파일(롤백·계획 뒤 변경·쓰기 실패)이나 되돌리지 못한 파일(적용 뒤 수정됨·없음)이 있거나 커밋하지 못했으면 1 */
  exitCode?: number;
}

const CATEGORIES = ["color", "spacing", "radius", "font-size"] as const;

function oneOf<T extends string>(flag: string, value: string | undefined, allowed: readonly T[]): T | undefined {
  if (value === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(value)) throw new Error(`${flag}는 ${allowed.join(" | ")} 중 하나여야 합니다: ${value}`);
  return value as T;
}

/** `.dsmith/reports/migrate-<date>.md` — 그날 이미 있으면 `-2`, `-3`…을 붙여 덮어쓰지 않는다 */
async function reportPathFor(root: string, now: Date): Promise<string> {
  const base = `.dsmith/reports/migrate-${localDate(now)}`;
  for (let n = 1; ; n += 1) {
    const rel = n === 1 ? `${base}.md` : `${base}-${n}.md`;
    try {
      await fs.access(path.join(root, ...rel.split("/")));
    } catch {
      return rel;
    }
  }
}

function numbersOf(detect: DetectResult, index: Index, plan: MigratePlan): AuditNumbers {
  const audit = computeAudit(detect, index);
  return {
    score: audit.health.score,
    hardcodedShare: audit.health.hardcodedShare,
    residual: residualByCategory(index.styles, planExcludes(plan)) satisfies Record<Token["category"], number>,
  };
}

async function loadState(root: string): Promise<{ detect: DetectResult; index: Index }> {
  const detect = await readDetect(root);
  const index = await readIndex(root);
  if (detect !== null && index !== null) return { detect, index };
  process.stderr.write("인덱스가 없어 audit을 먼저 실행함\n");
  await runAudit(root);
  const d = await readDetect(root);
  const i = await readIndex(root);
  if (d === null || i === null) throw new Error("audit 뒤에도 .dsmith/detect.json·index.json을 읽을 수 없음");
  return { detect: d, index: i };
}

/** 컴포넌트 편집이 있을 때만 붙는 ` · 컴포넌트 import N · prop M · 주석 K` */
function componentPart(applied: ApplyResult): string {
  if (applied.components + applied.props + applied.annotations === 0) return "";
  return ` · 컴포넌트 import ${applied.components} · prop ${applied.props}${applied.annotations > 0 ? ` · 지역 정의 주석 ${applied.annotations}` : ""}`;
}

/** 계획에 준 범위 플래그를 적용 안내에 되풀이할 문자열(`--close --files "…" --category … --only … --max-files …`) */
function scopeFlagsOf(opts: MigrateCommandOptions, category: string | undefined, only: string | undefined): string {
  const parts: string[] = [];
  if (opts.close === true) parts.push("--close");
  if (opts.files !== undefined && opts.files.length > 0) parts.push("--files", ...opts.files.map((g) => `"${g}"`));
  if (category !== undefined) parts.push("--category", category);
  if (only !== undefined) parts.push("--only", only);
  if (opts.maxFiles !== undefined) parts.push("--max-files", opts.maxFiles);
  return parts.join(" ");
}

function formatList(items: Awaited<ReturnType<typeof listMigrations>>): string {
  if (items.length === 0) return "마이그레이션 기록 없음";
  return items
    .map((m) => `${m.id}  ${m.status}  ${m.close ? "close" : "-"}  파일 ${m.summary.files} · 치환 ${m.summary.tokens}${m.summary.components > 0 ? ` · 컴포넌트 ${m.summary.components}` : ""}${m.branch === undefined ? "" : ` · 브랜치 ${m.branch}`}`)
    .join("\n");
}

function formatRevert(r: RevertResult): string {
  const count = (s: RevertResult["files"][number]["status"]): number => r.files.filter((f) => f.status === s).length;
  const lines = [
    `되돌림: ${r.id} — 되돌린 파일 ${count("reverted")} · 이미 원본 ${count("already-original")} · 건너뜀(적용 뒤 수정됨) ${count("skipped-modified")} · 없음 ${count("missing")}`,
  ];
  for (const f of r.files) if (f.status === "skipped-modified" || f.status === "missing") lines.push(`  ${f.file}: ${f.status}${f.reason === undefined ? "" : ` (${f.reason})`}`);
  return lines.join("\n");
}

/** `dsmith migrate`: 계획(기본, 아무것도 쓰지 않음) · `--apply` · `--revert <id>` · `--list` */
export async function runMigrateCommand(opts: MigrateCommandOptions): Promise<MigrateOutput> {
  // --branch로 브랜치를 만든 뒤(아직 없어지지 않았을 때) 어디서 실패하든 오류에 그 브랜치 이름을 붙인다
  const live: { branch: { name: string; base: string } | null } = { branch: null };
  try {
    return await runMigrate(opts, live);
  } catch (err) {
    if (live.branch === null) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${message}\n브랜치 ${live.branch.name}가 만들어져 체크아웃된 상태로 남아 있음(base: ${live.branch.base}) — 변경을 확인한 뒤 직접 정리하세요`);
  }
}

async function runMigrate(opts: MigrateCommandOptions, live: { branch: { name: string; base: string } | null }): Promise<MigrateOutput> {
  const root = path.resolve(opts.root);
  const category = oneOf("--category", opts.category, CATEGORIES);
  const only = oneOf("--only", opts.only, ["tokens", "components"] as const);
  let maxFiles: number | undefined;
  if (opts.maxFiles !== undefined) {
    maxFiles = Number(opts.maxFiles);
    if (!Number.isInteger(maxFiles) || maxFiles < 1) throw new Error(`--max-files는 1 이상의 정수여야 합니다: ${opts.maxFiles}`);
  }
  const modes = [opts.list === true, opts.revert !== undefined, opts.apply === true].filter(Boolean).length;
  if (modes > 1) throw new Error("--list, --revert <id>, --apply는 함께 쓸 수 없습니다");
  if (opts.branch !== undefined && opts.apply !== true) throw new Error("--branch는 --apply와 함께 씁니다");
  if (opts.withTokens === true && opts.branch === undefined) throw new Error("--with-tokens는 --branch와 함께 씁니다");

  if (opts.list === true) {
    const items = await listMigrations(root);
    return { json: items, text: formatList(items) };
  }


  if (opts.revert !== undefined) {
    const result = await revertMigration(root, opts.revert);
    await runAudit(root); // 인덱스·점수 갱신
    const notReverted = result.files.some((f) => f.status === "skipped-modified" || f.status === "missing");
    return { json: result, text: formatRevert(result), ...(notReverted ? { exitCode: 1 } : {}) };
  }

  const { detect, index } = await loadState(root);
  const extractors = buildExtractors(detect.activeExtractors);
  const { plan, fresh } = await analyzeMigration({
    root,
    extractors,
    detect,
    index,
    ...(opts.files === undefined || opts.files.length === 0 ? {} : { files: opts.files }),
    ...(category === undefined ? {} : { category }),
    ...(only === undefined ? {} : { only }),
    ...(opts.close === true ? { close: true } : {}),
    ...(maxFiles === undefined ? {} : { maxFiles }),
  });
  // 전/예상 점수는 audit 뒤 바뀐 파일까지 반영한 값이어야 한다: 계획이 디스크에서 다시 읽은 파일의 사용으로 인덱스를 갈아 끼운다
  const freshIndex = withFreshStyles(index, fresh);
  const before = numbersOf(detect, freshIndex, plan);
  // 토큰 치환과 계획된 컴포넌트 import 편집을 함께 반영해 편집 뒤 audit이 읽을 모양으로 맞춘다
  const projectedAfter = numbersOf(
    detect,
    { ...freshIndex, styles: projectStyles(freshIndex.styles, plan), components: projectComponents(freshIndex.components, plan) },
    plan,
  );
  const projected = { before, after: projectedAfter };

  if (opts.apply !== true) {
    return {
      json: { plan, projected, applied: null, actual: null },
      text: formatPlanSummary(plan, projected, { scopeFlags: scopeFlagsOf(opts, category, only) }),
    };
  }

  if (plan.files.length === 0) {
    return {
      json: { plan, projected, applied: null, actual: null },
      text: `${formatPlanSummary(plan, projected, { hint: false })}\n적용할 치환이 없음`,
    };
  }

  // --branch: 아무것도 쓰기 전에 git 상태를 확인한다(식별 정보·같은 이름 브랜치·대상 파일이 깨끗한가)
  let branch: NonNullable<MigrationRecord["branch"]> | undefined;
  let tokenCommitFiles: string[] = [];
  if (opts.branch !== undefined) {
    // 토큰 파일과 (연결된) 프리셋 파일도 브랜치에 있어야 한다 — 치환된 var()·프리셋이 가리킬 파일이 PR에서 빠지지 않게
    const check = await checkBranch(
      root,
      opts.branch,
      plan.files.map((f) => f.file),
      {
        tokenFiles: [...plan.tokens.files, ...(plan.preset !== null && plan.preset.linked ? [plan.preset.file] : [])],
        withTokens: opts.withTokens === true,
      },
    );
    if (!check.ok) throw new Error(`--branch를 쓸 수 없음: ${check.reason}`);
    tokenCommitFiles = check.include ?? [];
    await createBranch(root, opts.branch);
    live.branch = { name: opts.branch, base: check.base };
    branch = { name: opts.branch, base: check.base, baseSha: check.baseSha, commit: null };
  }

  const applied: ApplyResult = await applyMigration(root, plan, { extractors, version: cliVersion(), ...(branch === undefined ? {} : { branch }) });
  const appliedPaths = applied.files.filter((f) => f.status === "applied").map((f) => f.file);
  const failedFiles = applied.files.length - appliedPaths.length;
  const branchLines: string[] = [];
  let exitCode = failedFiles > 0 ? 1 : 0;
  if (branch !== undefined) {
    if (appliedPaths.length === 0) {
      await abandonBranch(root, branch.base, branch.name);
      live.branch = null;
      // 기록이 없앤 브랜치를 가리키지 않게 한다
      const note = `적용된 파일이 없어 브랜치 ${branch.name}를 만들지 않음(${branch.base}로 복귀)`;
      const record = await readMigration(root, applied.id);
      if (record !== null) {
        record.branch = null;
        record.branchNote = note;
        await writeMigration(root, record);
      }
      branchLines.push(note);
      branch = undefined;
    } else if (failedFiles > 0) {
      // 부분 실패는 커밋하지 않는다: 브랜치와 적용된 변경을 그대로 남기고 사람이 확인한다
      branchLines.push(
        `일부 파일(${failedFiles}개)을 적용하지 못해 커밋하지 않음 — 브랜치 ${branch.name}에 적용된 변경 ${appliedPaths.length}개 파일이 커밋되지 않은 채 남아 있음. 확인한 뒤 직접 커밋하거나 \`dsmith migrate --revert ${applied.id}\`로 되돌리세요`,
      );
    } else {
      try {
        const sha = await commitFiles(root, [...appliedPaths, ...tokenCommitFiles], commitMessage(applied.replaced, applied.components));
        branch.commit = sha;
        const record = await readMigration(root, applied.id);
        if (record !== null) {
          record.branch = branch;
          await writeMigration(root, record);
        }
        branchLines.push(`브랜치 ${branch.name}에 커밋 ${sha.slice(0, 7)} — PR은 직접 여세요`);
        if (tokenCommitFiles.length > 0) branchLines.push(`토큰 파일 ${tokenCommitFiles.length}개를 함께 커밋: ${tokenCommitFiles.join(", ")}`);
      } catch (err) {
        exitCode = 1;
        branchLines.push(`커밋하지 못함: ${(err as Error).message} — 브랜치 ${branch.name}에 변경이 커밋되지 않은 채 남아 있음`);
      }
    }
  }
  const { result: auditAfter } = await runAudit(root);
  const indexAfter = await readIndex(root);
  if (indexAfter === null) throw new Error("audit 뒤에도 .dsmith/index.json을 읽을 수 없음");
  const after: AuditNumbers = {
    score: auditAfter.health.score,
    hardcodedShare: auditAfter.health.hardcodedShare,
    residual: residualByCategory(indexAfter.styles, planExcludes(plan)),
  };
  const reportRel = await reportPathFor(root, new Date());
  await atomicWrite(path.join(root, ...reportRel.split("/")), renderMigrateReport({ plan, applied, before, after }));

  const text = [
    formatPlanSummary(plan, projected, { hint: false }),
    `적용: ${appliedPaths.length}개 파일 · 치환 ${applied.replaced}${componentPart(applied)} (되돌린 파일 ${failedFiles}) → 기록 ${applied.record}`,
    `실제: 점수 ${before.score} → ${after.score}, 하드코딩 비율 ${pct(before.hardcodedShare)} → ${pct(after.hardcodedShare)}`,
    `리포트: ${reportRel}`,
    ...branchLines,
  ].join("\n");
  return { json: { plan, projected, applied, actual: { before, after }, branch: branch ?? null }, text, exitCode };
}
