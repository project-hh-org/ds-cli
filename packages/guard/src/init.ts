import fs from "node:fs/promises";
import path from "node:path";
import {
  GUARD_FILE,
  readGuardSnapshotSync,
  safeWrite,
  writeGuardSnapshot,
  type GuardSnapshot,
  type PlannedWrite,
  type WriteOutcome,
} from "@dsmith-dev/core";
import type { DetectResult } from "@dsmith-dev/detect";
import {
  CONFIG_BLOCK,
  ESLINT_CONFIG_MARKERS,
  ESLINT_IMPORT_MARKERS,
  IMPORT_BLOCK,
  planEslintConfig,
  type EslintPlan,
} from "./eslint-config.js";
import { buildGuardSnapshot } from "./snapshot.js";
import { WORKFLOW_FILE, renderWorkflow } from "./workflow.js";

export interface GuardInitOptions {
  root: string;
  version: string;
  detect: DetectResult;
  ci?: "github";
  dryRun?: boolean;
  force?: boolean;
}

export interface GuardInitResult {
  /** ".dsmith/guard.json" */
  snapshot: string;
  counts: { tokens: number; dsComponents: number; deprecated: number; preferred: number };
  eslint: EslintPlan["status"];
  eslintFile?: string;
  snippet?: string;
  /** eslint 블록 2개 + package.json devDependency + (ci면) 워크플로 */
  outcomes: WriteOutcome[];
  workflow: string | null;
  notes: string[];
  dryRun: boolean;
}

const PLUGIN = "@dsmith-dev/eslint-plugin";
export const GUARD_INIT_MANIFEST = ".dsmith/guard-init.json";

async function readText(abs: string): Promise<string | null> {
  try {
    return await fs.readFile(abs, "utf-8");
  } catch {
    return null;
  }
}

async function exists(abs: string): Promise<boolean> {
  try {
    return (await fs.stat(abs)).isFile();
  } catch {
    return false;
  }
}

/**
 * guard.json 스냅샷, ESLint 설정 블록, (ci면) GitHub 워크플로를 만든다. 레포 파일은 전부 safeWrite(사용자가 고친 블록은 --force 없이 덮어쓰지 않음),
 * `.dsmith/guard.json`은 마지막에 — dryRun이면 아무것도 쓰지 않는다.
 */
export async function runGuardInit(opts: GuardInitOptions): Promise<GuardInitResult> {
  const root = path.resolve(opts.root);
  const dryRun = opts.dryRun === true;
  const notes: string[] = [];
  const snapshotFile = path.join(root, GUARD_FILE);

  let existing: GuardSnapshot | null = null;
  if (await exists(snapshotFile)) {
    try {
      existing = readGuardSnapshotSync(snapshotFile);
    } catch (err) {
      notes.push(`기존 ${GUARD_FILE}을 읽을 수 없어 새로 만듭니다: ${(err as Error).message}`);
    }
  }
  const snapshot = await buildGuardSnapshot({ root, detect: opts.detect, version: opts.version, existing });

  const lint = opts.detect.lint;
  const configText = lint.tool === "eslint" && lint.configFile !== undefined ? await readText(path.join(root, lint.configFile)) : null;
  const plan = planEslintConfig(root, lint, configText);

  const writes: PlannedWrite[] = [];
  if (plan.status === "insert" || plan.status === "present") {
    const configFile = path.join(root, plan.file);
    // 같은 파일의 블록 둘은 큰 줄 번호(config)부터 — insertAt이 원본 기준이라서
    writes.push({
      file: configFile,
      region: {
        kind: "block",
        start: ESLINT_CONFIG_MARKERS.start,
        end: ESLINT_CONFIG_MARKERS.end,
        ...(plan.status === "insert" ? { insertAt: plan.configLine } : {}),
      },
      content: CONFIG_BLOCK,
    });
    writes.push({
      file: configFile,
      region: {
        kind: "block",
        start: ESLINT_IMPORT_MARKERS.start,
        end: ESLINT_IMPORT_MARKERS.end,
        ...(plan.status === "insert" ? { insertAt: plan.importLine } : {}),
      },
      content: IMPORT_BLOCK,
    });
    if (await exists(path.join(root, "package.json"))) {
      writes.push({
        file: path.join(root, "package.json"),
        region: { kind: "json-key", keyPath: ["devDependencies", PLUGIN] },
        content: JSON.stringify(`^${opts.version}`),
      });
    }
  }
  if (opts.ci === "github") {
    writes.push({ file: path.join(root, WORKFLOW_FILE), region: { kind: "file" }, content: renderWorkflow(opts.version) });
  }

  const result =
    writes.length === 0
      ? { outcomes: [] as WriteOutcome[] }
      : await safeWrite(writes, {
          manifestFile: path.join(root, GUARD_INIT_MANIFEST),
          displayRoot: root,
          confineTo: root,
          tool: "guard",
          version: opts.version,
          ...(dryRun ? { dryRun: true } : {}),
          ...(opts.force === true ? { force: true } : {}),
        });

  // 스냅샷은 마지막에, dryRun이 아닐 때만
  if (!dryRun) await writeGuardSnapshot(root, snapshot);

  notes.push(`${GUARD_FILE}을 커밋해야 CI·ESLint가 같은 기준을 씁니다`);
  notes.push("ESLint 규칙은 JS/TS만 검사합니다. CSS·SCSS는 guard --ci가 검사합니다");
  notes.push(`${GUARD_FILE}이 없거나 깨지면 ESLint 규칙은 조용히 통과합니다`);
  notes.push(`eslint --cache를 쓰면 ${GUARD_FILE}을 바꾼 뒤 첫 실행은 캐시 없이(--no-cache) 돌리세요`);
  if (plan.status === "insert" || plan.status === "present") {
    if (result.outcomes.some((o) => o.status === "created" || o.status === "updated")) notes.push("패키지 매니저로 설치하세요(예: pnpm install)");
    for (const o of result.outcomes) {
      if (o.status.startsWith("skipped")) notes.push(`${o.file}: ${o.status}${o.reason !== undefined ? ` — ${o.reason}` : ""}`);
    }
  } else if (plan.status === "legacy" || plan.status === "unsupported-shape") {
    notes.push(`${plan.file}에 직접 추가하세요:\n${plan.snippet}`);
  } else if (plan.status === "not-eslint") {
    notes.push("guard의 즉시 검사는 ESLint 전용 — CI 검사(guard --ci)는 그대로 쓸 수 있음");
  } else {
    notes.push("ESLint 설정이 없어 즉시 검사 설정은 건너뜀 — CI 검사(guard --ci)는 그대로 쓸 수 있음");
  }

  const eslintFile = "file" in plan ? plan.file : undefined;
  const snippet = plan.status === "legacy" || plan.status === "unsupported-shape" ? plan.snippet : undefined;
  return {
    snapshot: GUARD_FILE,
    counts: {
      tokens: snapshot.tokens.length,
      dsComponents: snapshot.ds.components.length,
      deprecated: snapshot.ds.components.filter((c) => c.deprecated !== undefined).length,
      preferred: snapshot.preferred.length,
    },
    eslint: plan.status,
    ...(eslintFile !== undefined ? { eslintFile } : {}),
    ...(snippet !== undefined ? { snippet } : {}),
    outcomes: result.outcomes,
    workflow: opts.ci === "github" ? WORKFLOW_FILE : null,
    notes,
    dryRun,
  };
}
