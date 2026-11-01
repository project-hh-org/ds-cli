import fs from "node:fs/promises";
import path from "node:path";
import {
  applyPatches,
  extractorMatchers,
  newMigrationId,
  sha256Text,
  writeMigration,
  writePatchedFile,
  type MigrationFile,
  type MigrationRecord,
  type TextPatch,
} from "@dsmith-dev/core";
import type { Extractor } from "@dsmith-dev/extractor-api";
import { countComponentEdits, loadModuleEnv } from "./components.js";
import type { FilePlan, MigratePlan, TokenSkipReason } from "./plan.js";
import { checkComponents, checkEdit } from "./verify.js";

export interface ApplyFileResult {
  file: string;
  status: "applied" | "rolled-back" | "changed-since-plan";
  replacements: number;
  /** 옮긴 컴포넌트 import 수((파일, 항목) 단위) */
  components: number;
  /** 바뀐 prop 수 */
  props: number;
  /** 지역 정의에 붙인 주석 수 */
  annotations: number;
  reason?: string;
}

export interface ApplyResult {
  id: string;
  /** root 상대 기록 파일 경로 */
  record: string;
  files: ApplyFileResult[];
  replaced: number;
  /** 적용된 컴포넌트 import 수 */
  components: number;
  props: number;
  annotations: number;
  /** 적용하지 못한 파일(검증 실패·계획 뒤 변경)에 있던 컴포넌트 import 수 */
  componentsRolledBack: number;
  /** 적용하지 못한 파일의 계획 치환 수 — plan.skipped와 같은 이름("rolled-back")으로 보고한다 */
  skipped: Partial<Record<TokenSkipReason, number>>;
}

interface Prepared {
  fp: FilePlan;
  result: ApplyFileResult;
  entry: MigrationFile;
  after?: string;
}

/**
 * 계획을 파일 단위로 적용한다. 순서:
 * 1) 파일마다 읽기 전용 검증(해시 일치 → applyPatches → validateEdit → 재추출 검증) — 통과한 파일만 적용 후보
 * 2) 기록(`.dsmith/migrations/<id>.json`, status "applying")을 **소스보다 먼저** 쓴다
 * 3) 후보를 `writePatchedFile`(쓰기 직전 해시 비교)로 쓰고 파일마다 기록 갱신, 끝나면 status "applied"
 * 검증에 실패한 파일은 쓰지 않는다(rolled-back). 다른 파일은 계속 적용한다.
 */
export async function applyMigration(
  root: string,
  plan: MigratePlan,
  opts: { extractors: Extractor[]; version: string; now?: Date; branch?: MigrationRecord["branch"] },
): Promise<ApplyResult> {
  for (const extractor of opts.extractors) await extractor.prepare?.(root);
  const matchers = extractorMatchers(opts.extractors);
  const id = await newMigrationId(root, opts.now ?? new Date());
  const env = await loadModuleEnv(root);

  const prepared: Prepared[] = [];
  for (const fp of plan.files) {
    const n = fp.replacements.length;
    const counts = countComponentEdits(fp.components);
    const c = counts.imports;
    const reject = (status: "rolled-back" | "changed-since-plan", reason: string): Prepared => ({
      fp,
      result: { file: fp.file, status, replacements: n, components: c, props: counts.props, annotations: counts.annotations, reason },
      entry: { file: fp.file, before: fp.sha256, after: fp.sha256, patches: [], status: "rolled-back", reason },
    });

    let current: string;
    try {
      current = await fs.readFile(path.resolve(root, fp.file), "utf-8");
    } catch (err) {
      prepared.push(reject("changed-since-plan", `파일을 읽을 수 없음: ${(err as Error).message}`));
      continue;
    }
    if (sha256Text(current) !== fp.sha256) {
      prepared.push(reject("changed-since-plan", "계획 뒤 파일이 바뀜"));
      continue;
    }
    let after: string;
    try {
      after = applyPatches(current, fp.patches);
    } catch (err) {
      prepared.push(reject("rolled-back", `패치 적용 실패: ${(err as Error).message}`));
      continue;
    }
    const mismatch = checkEdit(root, fp.file, current, after, n, matchers) ?? checkComponents(fp.file, after, fp.componentChecks, env);
    if (mismatch !== null) {
      prepared.push(reject("rolled-back", mismatch));
      continue;
    }
    const patches = fp.patches.map((p: TextPatch) => ({ ...p, original: current.slice(p.start, p.end) }));
    prepared.push({
      fp,
      after,
      result: { file: fp.file, status: "applied", replacements: n, components: c, props: counts.props, annotations: counts.annotations },
      entry: { file: fp.file, before: fp.sha256, after: sha256Text(after), patches, status: "pending" },
    });
  }

  const record: MigrationRecord = {
    version: 1,
    id,
    dsmith: opts.version,
    createdAt: (opts.now ?? new Date()).toISOString(),
    status: "applying",
    summary: { tokens: 0, components: 0, files: 0 },
    ...(opts.branch === undefined ? {} : { branch: opts.branch }),
    files: prepared.map((p) => p.entry),
  };
  const recordPath = await writeMigration(root, record);

  for (const p of prepared) {
    if (p.entry.status !== "pending" || p.after === undefined) continue;
    const written = await writePatchedFile(root, p.fp.file, p.fp.sha256, p.after);
    if (written.written) {
      p.entry.status = "applied";
    } else {
      p.entry.status = "rolled-back";
      p.entry.reason = written.reason ?? "쓰지 못함";
      p.result.status = written.reason === "계획 뒤 파일이 바뀜" ? "changed-since-plan" : "rolled-back";
      p.result.reason = p.entry.reason;
    }
    await writeMigration(root, record);
  }

  const files = prepared.map((p) => p.result);
  const appliedFiles = files.filter((f) => f.status === "applied");
  const replaced = appliedFiles.reduce((n, f) => n + f.replacements, 0);
  const components = appliedFiles.reduce((n, f) => n + f.components, 0);
  const props = appliedFiles.reduce((n, f) => n + f.props, 0);
  const annotations = appliedFiles.reduce((n, f) => n + f.annotations, 0);
  const lost = files.filter((f) => f.status !== "applied").reduce((n, f) => n + f.replacements, 0);
  const componentsLost = files.filter((f) => f.status !== "applied").reduce((n, f) => n + f.components, 0);
  record.status = "applied";
  record.summary = { tokens: replaced, components, files: appliedFiles.length };
  await writeMigration(root, record);

  return {
    id,
    record: recordPath,
    files,
    replaced,
    components,
    props,
    annotations,
    componentsRolledBack: componentsLost,
    skipped: lost > 0 ? { "rolled-back": lost } : {},
  };
}
