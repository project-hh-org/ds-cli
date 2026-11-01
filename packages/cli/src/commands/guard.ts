import path from "node:path";
import { GUARD_FILE, readGuardSnapshotSync } from "@dsmith-dev/core";
import { detect } from "@dsmith-dev/detect";
import {
  formatGuardInitSummary,
  runGuardCi,
  runGuardInit,
  type GuardCiResult,
  type GuardInitResult,
} from "@dsmith-dev/guard";
import { buildExtractors, metas } from "../registry.js";
import { cliVersion } from "../version.js";

export interface GuardInitCommandOptions {
  root: string;
  ci?: string | undefined;
  dryRun?: boolean | undefined;
  force?: boolean | undefined;
}

/**
 * `dsmith guard init`: 지금 레포를 다시 감지(저장하지 않음 — ESLint 설정은 audit 뒤에 생길 수 있다)해 guard.json·ESLint 설정·워크플로를 만든다.
 */
export async function runGuardInitCommand(opts: GuardInitCommandOptions): Promise<{ result: GuardInitResult; text: string }> {
  if (opts.ci !== undefined && opts.ci !== "github") throw new Error(`--ci는 github만 지원합니다: ${opts.ci}`);
  const root = path.resolve(opts.root);
  const detected = await detect(root, undefined, { available: metas() });
  const result = await runGuardInit({
    root,
    version: cliVersion(),
    detect: detected,
    ...(opts.ci === "github" ? { ci: "github" as const } : {}),
    ...(opts.dryRun === true ? { dryRun: true } : {}),
    ...(opts.force === true ? { force: true } : {}),
  });
  return { result, text: formatGuardInitSummary(result) };
}

export interface GuardCiCommandOptions {
  root: string;
  base?: string | undefined;
  comment?: boolean | undefined;
}

/** `dsmith guard --ci --base <ref>`: 스냅샷에 적힌 Extractor로 PR의 신규 드리프트를 센다. 코멘트 실패는 stderr 경고뿐이다. */
export async function runGuardCiCommand(opts: GuardCiCommandOptions): Promise<GuardCiResult> {
  if (opts.base === undefined || opts.base === "") throw new Error("--ci에는 --base <ref>가 필요합니다 (예: --base origin/main)");
  const root = path.resolve(opts.root);
  let names: string[];
  try {
    names = readGuardSnapshotSync(path.join(root, GUARD_FILE)).extractors;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT" && !/ENOENT/.test((err as Error).message)) throw err;
    throw new Error(`${GUARD_FILE}이 없습니다 — 먼저 \`dsmith guard init\`을 실행하고 커밋하세요`);
  }
  const result = await runGuardCi({
    root,
    base: opts.base,
    extractors: buildExtractors(names),
    ...(opts.comment === true ? { comment: true } : {}),
  });
  if (result.comment?.status === "failed") {
    process.stderr.write(`경고: PR 코멘트를 달지 못했습니다: ${result.comment.reason ?? "알 수 없음"}\n`);
  }
  return result;
}
