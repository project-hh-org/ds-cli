import path from "node:path";
import { atomicWrite, listMigrations, localDate, readIndex, type Index, type Token } from "@dsmith-dev/core";
import { readDetect, type DetectResult } from "@dsmith-dev/detect";
import {
  applyMigration,
  formatPlanSummary,
  planExcludes,
  planMigration,
  projectStyles,
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
  minConfidence?: string | undefined;
  maxFiles?: string | undefined;
  apply?: boolean | undefined;
  branch?: string | undefined;
  revert?: string | undefined;
  list?: boolean | undefined;
}

export interface MigrateOutput {
  /** `--json`일 때 stdout에 쓸 값 */
  json: unknown;
  /** 사람용 출력 */
  text: string;
}

const CATEGORIES = ["color", "spacing", "radius", "font-size"] as const;

function oneOf<T extends string>(flag: string, value: string | undefined, allowed: readonly T[]): T | undefined {
  if (value === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(value)) throw new Error(`${flag}는 ${allowed.join(" | ")} 중 하나여야 합니다: ${value}`);
  return value as T;
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

function formatList(items: Awaited<ReturnType<typeof listMigrations>>): string {
  if (items.length === 0) return "마이그레이션 기록 없음";
  return items
    .map((m) => `${m.id}  ${m.status}  파일 ${m.summary.files} · 치환 ${m.summary.tokens}${m.summary.components > 0 ? ` · 컴포넌트 ${m.summary.components}` : ""}${m.branch === undefined ? "" : ` · 브랜치 ${m.branch}`}`)
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
  const root = path.resolve(opts.root);
  const category = oneOf("--category", opts.category, CATEGORIES);
  const only = oneOf("--only", opts.only, ["tokens", "components"] as const);
  const minConfidence = oneOf("--min-confidence", opts.minConfidence, ["exact", "close"] as const);
  let maxFiles: number | undefined;
  if (opts.maxFiles !== undefined) {
    maxFiles = Number(opts.maxFiles);
    if (!Number.isInteger(maxFiles) || maxFiles < 1) throw new Error(`--max-files는 1 이상의 정수여야 합니다: ${opts.maxFiles}`);
  }
  const modes = [opts.list === true, opts.revert !== undefined, opts.apply === true].filter(Boolean).length;
  if (modes > 1) throw new Error("--list, --revert <id>, --apply는 함께 쓸 수 없습니다");
  if (opts.branch !== undefined && opts.apply !== true) throw new Error("--branch는 --apply와 함께 씁니다");
  if (opts.branch !== undefined) throw new Error("--branch는 아직 지원하지 않습니다");

  if (opts.list === true) {
    const items = await listMigrations(root);
    return { json: items, text: formatList(items) };
  }


  if (opts.revert !== undefined) {
    const result = await revertMigration(root, opts.revert);
    await runAudit(root); // 인덱스·점수 갱신
    return { json: result, text: formatRevert(result) };
  }

  const { detect, index } = await loadState(root);
  const extractors = buildExtractors(detect.activeExtractors);
  const plan = await planMigration({
    root,
    extractors,
    detect,
    index,
    ...(opts.files === undefined || opts.files.length === 0 ? {} : { files: opts.files }),
    ...(category === undefined ? {} : { category }),
    ...(only === undefined ? {} : { only }),
    ...(minConfidence === undefined ? {} : { minConfidence }),
    ...(maxFiles === undefined ? {} : { maxFiles }),
  });
  const before = numbersOf(detect, index, plan);
  const projectedAfter = numbersOf(detect, { ...index, styles: projectStyles(index.styles, plan) }, plan);
  const projected = { before, after: projectedAfter };

  if (opts.apply !== true) {
    return {
      json: { plan, projected, applied: null, actual: null },
      text: formatPlanSummary(plan, projected),
    };
  }

  if (plan.planned === 0) {
    return {
      json: { plan, projected, applied: null, actual: null },
      text: `${formatPlanSummary(plan, projected, { hint: false })}\n적용할 치환이 없음`,
    };
  }

  const applied: ApplyResult = await applyMigration(root, plan, { extractors, version: cliVersion() });
  const { result: auditAfter } = await runAudit(root);
  const indexAfter = await readIndex(root);
  if (indexAfter === null) throw new Error("audit 뒤에도 .dsmith/index.json을 읽을 수 없음");
  const after: AuditNumbers = {
    score: auditAfter.health.score,
    hardcodedShare: auditAfter.health.hardcodedShare,
    residual: residualByCategory(indexAfter.styles, planExcludes(plan)),
  };
  const reportRel = `.dsmith/reports/migrate-${localDate(new Date())}.md`;
  await atomicWrite(path.join(root, ...reportRel.split("/")), renderMigrateReport({ plan, applied, before, after }));

  const appliedFiles = applied.files.filter((f) => f.status === "applied").length;
  const rolledBack = applied.files.length - appliedFiles;
  const text = [
    formatPlanSummary(plan, projected, { hint: false }),
    `적용: ${appliedFiles}개 파일 · 치환 ${applied.replaced} (되돌린 파일 ${rolledBack}) → 기록 ${applied.record}`,
    `실제: 점수 ${before.score} → ${after.score}, 하드코딩 비율 ${pct(before.hardcodedShare)} → ${pct(after.hardcodedShare)}`,
    `리포트: ${reportRel}`,
  ].join("\n");
  return { json: { plan, projected, applied, actual: { before, after } }, text };
}
