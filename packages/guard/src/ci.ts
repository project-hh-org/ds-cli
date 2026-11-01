import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import picomatch from "picomatch";
import type { Extractor } from "@dsmith-dev/extractor-api";
import {
  GUARD_FILE,
  eligibleFindings,
  evaluateFile,
  extractComponentUsage,
  extractFileStyles,
  extractorMatchers,
  findingKey,
  moduleContextOf,
  parseTsx,
  readGuardSnapshotSync,
  ruleContextOf,
  staleGuardTokenFiles,
  type ComponentUsage,
  type Finding,
  type GuardSnapshot,
} from "@dsmith-dev/core";
import { renderComment } from "./comment.js";
import { changedFiles, fileAtBase } from "./diff.js";
import { prContextFromEnv, upsertComment } from "./github.js";

export interface GuardCiOptions {
  root: string;
  base: string;
  extractors: Extractor[];
  comment?: boolean;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}

export interface GuardCiResult {
  base: string;
  mergeBase: string;
  /** 검사한 변경 파일(제외·Extractor 범위 밖 뺌) */
  files: string[];
  /** head − base (findingKey 다중집합 차) */
  newFindings: Finding[];
  counts: { newHardcoded: number; newReplaceable: number; newNonDs: number; newDeprecated: number; removedHardcoded: number };
  /** 기록 해시와 다른 토큰 파일 */
  staleSnapshot: string[];
  /** newHardcoded > failOn.newHardcoded || newDeprecated > failOn.deprecated */
  exitCode: 0 | 1;
  /** 코멘트 본문(마커 포함) */
  body: string;
  comment: { status: "created" | "updated" | "unchanged" | "skipped" | "failed"; reason?: string } | null;
}

const SCRIPT_FILE = /\.[cm]?[jt]sx?$/;

function globMatcher(globs: readonly string[]): (file: string) => boolean {
  return globs.length === 0 ? () => false : picomatch([...globs], { dot: true });
}

/** 한 파일 내용을 규칙 엔진에 태운다. 추출이 실패하면 null(그 파일은 비교에서 뺀다). */
function findingsOf(
  code: string,
  file: string,
  root: string,
  snapshot: GuardSnapshot,
  matchers: ReturnType<typeof extractorMatchers>,
): Finding[] | null {
  try {
    const usages = extractFileStyles({ root, file, code }, matchers).styles;
    let components: ComponentUsage[] = [];
    if (SCRIPT_FILE.test(file)) {
      components = extractComponentUsage(file, parseTsx(code, file), snapshot.moduleContext.tsPaths, moduleContextOf(snapshot));
    }
    return eligibleFindings(evaluateFile({ file, usages, components, ...ruleContextOf(snapshot) }));
  } catch {
    return null;
  }
}

/** PR이 base(merge-base) 대비 새로 들인 드리프트만 센다. 줄 이동에는 findingKey(규칙·속성·값)로 강하다. */
export async function runGuardCi(opts: GuardCiOptions): Promise<GuardCiResult> {
  const root = path.resolve(opts.root);
  const snapshotFile = path.join(root, GUARD_FILE);
  if (!fs.existsSync(snapshotFile)) throw new Error(`${GUARD_FILE}이 없습니다 — 먼저 \`dsmith guard init\`을 실행하고 커밋하세요`);
  const snapshot = readGuardSnapshotSync(snapshotFile);

  const changed = await changedFiles(root, opts.base);
  for (const extractor of opts.extractors) await extractor.prepare?.(root);
  const matchers = extractorMatchers(opts.extractors, { dot: true });
  const excluded = globMatcher(snapshot.exclude);
  const allowed = globMatcher(snapshot.policy.allow.files);

  const files: string[] = [];
  const newFindings: Finding[] = [];
  let removedHardcoded = 0;
  for (const file of changed.files) {
    if (excluded(file) || allowed(file)) continue;
    if (!SCRIPT_FILE.test(file) && !matchers.some((m) => m.matches(file))) continue;
    let head: string;
    try {
      head = await fsp.readFile(path.join(root, file), "utf-8");
    } catch {
      continue;
    }
    const headFindings = findingsOf(head, file, root, snapshot, matchers);
    if (headFindings === null) continue;
    files.push(file);

    const baseCode = await fileAtBase(root, changed.mergeBase, file);
    const baseFindings = baseCode === null ? [] : (findingsOf(baseCode, file, root, snapshot, matchers) ?? []);
    const remaining = new Map<string, number>();
    for (const f of baseFindings) remaining.set(findingKey(f), (remaining.get(findingKey(f)) ?? 0) + 1);
    for (const f of headFindings) {
      const key = findingKey(f);
      const left = remaining.get(key) ?? 0;
      if (left > 0) remaining.set(key, left - 1);
      else newFindings.push(f);
    }
    for (const f of baseFindings) {
      if (f.rule !== "no-hardcoded-style") continue;
      const key = findingKey(f);
      const left = remaining.get(key) ?? 0;
      if (left > 0) {
        removedHardcoded += 1;
        remaining.set(key, left - 1);
      }
    }
  }

  const counts = {
    newHardcoded: newFindings.filter((f) => f.rule === "no-hardcoded-style").length,
    newReplaceable: newFindings.filter((f) => f.rule === "no-hardcoded-style" && f.style?.replacement != null).length,
    newNonDs: newFindings.filter((f) => f.rule === "prefer-ds-component").length,
    newDeprecated: newFindings.filter((f) => f.rule === "no-deprecated-component").length,
    removedHardcoded,
  };
  const staleSnapshot = await staleGuardTokenFiles(root, snapshot);
  const { policy } = snapshot;
  const exitCode: 0 | 1 = counts.newHardcoded > policy.failOn.newHardcoded || counts.newDeprecated > policy.failOn.deprecated ? 1 : 0;

  const partial = { base: changed.base, mergeBase: changed.mergeBase, files, newFindings, counts, staleSnapshot, exitCode };
  const body = renderComment(partial, policy);

  let comment: GuardCiResult["comment"] = null;
  if (opts.comment === true) {
    const ctx = prContextFromEnv(opts.env ?? process.env, (p) => fs.readFileSync(p, "utf-8"));
    if ("error" in ctx) comment = { status: "failed", reason: ctx.error };
    else {
      comment = await upsertComment(ctx, body, {
        fetchImpl: opts.fetchImpl ?? fetch,
        createIfClean: newFindings.length > 0 || removedHardcoded > 0,
      });
    }
  }
  return { ...partial, body, comment };
}
