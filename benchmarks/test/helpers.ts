import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractorMatchers, type GuardSnapshot } from "@dsmith-dev/core";
import { readDetect } from "@dsmith-dev/detect";
import { buildGuardSnapshot } from "@dsmith-dev/guard";
import { extractorsFor } from "../src/extractors.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "../..");
export const CLI_BIN = path.join(REPO_ROOT, "packages/cli/dist/bin.js");

export const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };

const tmps: string[] = [];
export function tmpDir(prefix: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmps.push(dir);
  return dir;
}
export function cleanupTmps(): void {
  for (const t of tmps.splice(0)) fs.rmSync(t, { recursive: true, force: true });
}

export function dsmith(root: string, ...args: string[]): string {
  const r = spawnSync(process.execPath, [CLI_BIN, ...args], { cwd: root, encoding: "utf-8", env: GIT_ENV });
  if (r.status !== 0) throw new Error(`dsmith ${args.join(" ")} 실패(${r.status}): ${r.stderr}${r.stdout}`);
  return r.stdout;
}

export function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf-8", env: GIT_ENV });
}

/** 모노레포 원본을 임시 디렉터리로 복사한다(.dsmith 제외). */
export function copyRepo(rel: string): string {
  const root = tmpDir("dsmith-bench-");
  fs.cpSync(path.join(REPO_ROOT, rel), root, { recursive: true, filter: (p) => !p.split(path.sep).includes(".dsmith") });
  return root;
}

export interface PreparedBase {
  root: string;
  snapshot: GuardSnapshot;
  matchers: ReturnType<typeof extractorMatchers>;
}

/**
 * legacy-demo 복사 → audit → init --all → ai → readDetect → buildGuardSnapshot (plan 결정 1·2의 공통 베이스).
 * `ai`가 있어야 `.dsmith/catalog.json`이 생겨 스냅샷의 ds.components·ds.modules(4개)가 채워진다 — init만으로는 모듈이 1개, 컴포넌트가 0개다.
 */
export async function prepareDemoBase(): Promise<PreparedBase> {
  const root = copyRepo("examples/legacy-demo");
  dsmith(root, "audit");
  dsmith(root, "init", "--all");
  dsmith(root, "ai");
  return baseOf(root);
}

export async function baseOf(root: string): Promise<PreparedBase> {
  const detect = await readDetect(root);
  if (detect === null) throw new Error("detect 결과 없음");
  const snapshot = await buildGuardSnapshot({ root, detect, version: "0.0.0-bench", existing: null });
  const extractors = extractorsFor(snapshot.extractors);
  for (const e of extractors) await e.prepare?.(root);
  return { root, snapshot, matchers: extractorMatchers(extractors, { dot: true }) };
}

/** 부록 D.3 프로브 파일 */
export const PROBE = `import { Button } from "@/components/ui/button";
import { Card } from "./Card";

export const Probe = () => (
  <Card>
    <Button
      className="bg-[#3b82f6] p-4 bg-[color:var(--color-blue-400)] p-[var(--space-2)] text-[var(--made-up)] bg-ds-blue-400 rounded-lg"
      style={{ color: "#111827", padding: "var(--space-4)", margin: 8 }}
    />
  </Card>
);
`;
