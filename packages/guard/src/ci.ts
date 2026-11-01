import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
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
  findInitDir,
  findTailwindConfig,
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
  /** 기록 해시와 다른 토큰 파일. 스냅샷에 없는 새 토큰 파일은 `+<file>` */
  staleSnapshot: string[];
  /** head 파일 중 추출·파싱에 실패해 검사하지 못한 것(files에는 포함) */
  parseFailed: string[];
  /** 이 PR이 guard 정책(policy·exclude)을 바꿨는가 — 그래도 merge-base 정책으로 판정한다 */
  policyChanged: boolean;
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

/**
 * 판정 기준(policy·exclude)은 PR이 아니라 merge-base의 guard.json에서 읽는다 — PR이 자기 게이트를 풀지 못하게.
 * merge-base에 guard.json이 없으면(첫 guard PR)·읽을 수 없으면 head를 쓴다.
 */
async function gateOf(root: string, mergeBase: string, head: GuardSnapshot): Promise<{ policy: GuardSnapshot["policy"]; exclude: string[]; changed: boolean }> {
  const text = await fileAtBase(root, mergeBase, GUARD_FILE);
  if (text === null) return { policy: head.policy, exclude: head.exclude, changed: false };
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "dsmith-guard-base-"));
  try {
    const file = path.join(dir, "guard.json");
    await fsp.writeFile(file, text, "utf-8");
    const base = readGuardSnapshotSync(file);
    return { policy: base.policy, exclude: base.exclude, changed: JSON.stringify([base.policy, base.exclude]) !== JSON.stringify([head.policy, head.exclude]) };
  } catch {
    return { policy: head.policy, exclude: head.exclude, changed: false };
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

/** 스냅샷이 모르는 토큰 파일(Tailwind 설정, init 산출 tokens.css/json) — `+<file>` */
async function untrackedTokenFiles(root: string, snapshot: GuardSnapshot): Promise<string[]> {
  const known = new Set(snapshot.tokenFiles.map((t) => t.file));
  const candidates: string[] = [];
  const tw = await findTailwindConfig(root);
  if (tw !== null) candidates.push(tw);
  const initDir = await findInitDir(root);
  if (initDir !== null) for (const name of ["tokens.css", "tokens.json"]) candidates.push(initDir === "." ? name : `${initDir}/${name}`);
  const out: string[] = [];
  for (const file of candidates) {
    if (known.has(file)) continue;
    try {
      if ((await fsp.stat(path.join(root, file))).isFile()) out.push(`+${file}`);
    } catch {
      // 없음
    }
  }
  return out.sort();
}

/** PR이 base(merge-base) 대비 새로 들인 드리프트만 센다. 줄 이동에는 findingKey(규칙·속성·값)로 강하다. */
export async function runGuardCi(opts: GuardCiOptions): Promise<GuardCiResult> {
  const root = path.resolve(opts.root);
  const snapshotFile = path.join(root, GUARD_FILE);
  if (!fs.existsSync(snapshotFile)) throw new Error(`${GUARD_FILE}이 없습니다 — 먼저 \`dsmith guard init\`을 실행하고 커밋하세요`);
  const headSnapshot = readGuardSnapshotSync(snapshotFile);

  const changed = await changedFiles(root, opts.base);
  const gate = await gateOf(root, changed.mergeBase, headSnapshot);
  const snapshot: GuardSnapshot = { ...headSnapshot, policy: gate.policy, exclude: gate.exclude };
  for (const extractor of opts.extractors) await extractor.prepare?.(root);
  const matchers = extractorMatchers(opts.extractors, { dot: true });
  const excluded = globMatcher(snapshot.exclude);
  const allowed = globMatcher(snapshot.policy.allow.files);

  const files: string[] = [];
  const parseFailed: string[] = [];
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
    files.push(file);
    if (headFindings === null) {
      parseFailed.push(file);
      continue;
    }

    // 이름만 바뀐 파일은 옛 경로의 base 내용과 비교한다
    const baseFile = changed.baseOf.get(file) ?? file;
    const baseCode = await fileAtBase(root, changed.mergeBase, baseFile);
    const baseFindings = baseCode === null ? [] : (findingsOf(baseCode, baseFile, root, snapshot, matchers) ?? []);
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
  const staleSnapshot = [...(await staleGuardTokenFiles(root, headSnapshot)), ...(await untrackedTokenFiles(root, headSnapshot))];
  const { policy } = snapshot;
  const exitCode: 0 | 1 = counts.newHardcoded > policy.failOn.newHardcoded || counts.newDeprecated > policy.failOn.deprecated ? 1 : 0;

  const partial = {
    base: changed.base,
    mergeBase: changed.mergeBase,
    files,
    newFindings,
    counts,
    staleSnapshot,
    parseFailed,
    policyChanged: gate.changed,
    exitCode,
  };
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
