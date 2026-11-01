import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractorMatchers, sha256Text, type GuardSnapshot } from "@dsmith-dev/core";
import { readDetect } from "@dsmith-dev/detect";
import { buildGuardSnapshot } from "@dsmith-dev/guard";
import { agentEnv } from "./agent.js";
import { extractorsFor } from "./extractors.js";
import type { Condition } from "./model.js";

export const REPOS = { "legacy-demo": "examples/legacy-demo", "with-ds-app": "fixtures/with-ds-app" } as const;
export type RepoName = keyof typeof REPOS;

/** benchmarks/src 또는 benchmarks/dist 기준 ../.. */
export const MONOREPO_ROOT: string = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const CLI_BIN: string = path.join(MONOREPO_ROOT, "packages/cli/dist/bin.js");

export interface Base {
  dir: string;
  snapshot: GuardSnapshot;
  snapshotSha256: string;
  matchers: ReturnType<typeof extractorMatchers>;
}

const DS_SECTION = /<!-- dsmith:(?:ds:)?start -->[\s\S]*?<!-- dsmith:(?:ds:)?end -->\n?/g;

/** 정리된 환경으로 `node CLI_BIN <args>`를 cwd에서 실행한다. 종료 코드가 0이 아니면 stderr를 담아 던진다. */
function runCli(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_BIN, ...args], { cwd, env: agentEnv([]), stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString("utf-8")));
    child.stderr.on("data", (d: Buffer) => (err += d.toString("utf-8")));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`dsmith ${args.join(" ")} 실패(종료 코드 ${String(code)}): ${err.trim()}${out === "" ? "" : `\n${out.trim().slice(-2000)}`}`));
    });
  });
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p);
    return true;
  } catch {
    return false;
  }
}

async function mkTmp(prefix: string): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  const rel = path.relative(MONOREPO_ROOT, dir);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    await fs.rm(dir, { recursive: true, force: true });
    throw new Error(`임시 디렉터리가 모노레포 아래입니다(${dir}) — TMPDIR을 모노레포 밖으로 지정하세요`);
  }
  return dir;
}

async function copyDir(from: string, to: string): Promise<void> {
  await fs.cp(from, to, { recursive: true, filter: (src) => path.basename(src) !== ".dsmith" || src === from });
}

/** 복사본에 채점 코드(benchmarks/)가 있으면 던진다 — 에이전트에 정답 기준이 노출되면 안 된다. */
async function assertNoHarness(dir: string): Promise<void> {
  if (await exists(path.join(dir, "benchmarks"))) throw new Error(`복사본에 benchmarks/ 디렉터리가 있습니다: ${dir}`);
}

/**
 * mkdtemp(dsmith-bench-base-) ← REPOS[repo] 복사(.dsmith 제외) → `audit` → `init --all` → `ai`(모두 node CLI_BIN, cwd=dir, 정리된 env).
 * `ai`까지 거쳐야 .dsmith/catalog.json이 생겨 스냅샷의 DS module·컴포넌트가 채워진다(없으면 nonDs가 늘 0). 상태 override 없음(결정 1).
 * 스냅샷은 이 베이스에서 한 번 만들어 두 조건 모두에 쓴다(결정 2).
 */
export async function prepareBase(repo: RepoName): Promise<Base> {
  if (!(await exists(CLI_BIN))) throw new Error(`${CLI_BIN} 이 없습니다 — 먼저 pnpm -r build 를 실행하세요`);
  const dir = await mkTmp("dsmith-bench-base-");
  try {
    await copyDir(path.join(MONOREPO_ROOT, REPOS[repo]), dir);
    await assertNoHarness(dir);
    await runCli(dir, ["audit", "--json"]);
    await runCli(dir, ["init", "--all", "--json"]);
    await runCli(dir, ["ai", "--json"]);
    const detect = await readDetect(dir);
    if (detect === null) throw new Error(`detect 결과가 없습니다: ${dir}`);
    const snapshot = await buildGuardSnapshot({ root: dir, detect, version: "bench", existing: null });
    const extractors = extractorsFor(snapshot.extractors);
    for (const e of extractors) await e.prepare?.(dir);
    return { dir, snapshot, snapshotSha256: sha256Text(JSON.stringify(snapshot)), matchers: extractorMatchers(extractors, { dot: true }) };
  } catch (e) {
    await fs.rm(dir, { recursive: true, force: true });
    throw e;
  }
}

/** AGENTS.md에서 dsmith 마커 블록(`dsmith:ds`·`dsmith`)을 뺀다. 남는 것이 공백뿐이면 파일을 지운다. */
async function stripAgentsSection(dir: string): Promise<void> {
  const file = path.join(dir, "AGENTS.md");
  if (!(await exists(file))) return;
  const rest = (await fs.readFile(file, "utf-8")).replace(DS_SECTION, "");
  if (rest.trim() === "") await fs.rm(file);
  else await fs.writeFile(file, `${rest.replace(/\s+$/, "")}\n`);
}

/**
 * base.dir을 새 mkdtemp로 복사한 조건 템플릿.
 * baseline: `.dsmith/`·`.mcp.json`·AGENTS.md의 dsmith 섹션(그것뿐이면 파일째) 삭제 → dsmith 흔적 없음.
 * dsmith: `install --tool <installTool> --mcp-command "node <CLI_BIN>"` (ai는 베이스에서 이미 실행됨) → AGENTS.md에 DS 마커가 있어야 한다.
 */
export async function prepareCondition(base: Base, condition: Condition, installTool: string): Promise<string> {
  const dir = await mkTmp(`dsmith-bench-${condition}-`);
  try {
    await fs.cp(base.dir, dir, { recursive: true });
    await assertNoHarness(dir);
    if (condition === "baseline") {
      await fs.rm(path.join(dir, ".dsmith"), { recursive: true, force: true });
      await fs.rm(path.join(dir, ".mcp.json"), { force: true });
      await stripAgentsSection(dir);
    } else {
      await runCli(dir, ["install", "--tool", installTool, "--mcp-command", `node ${CLI_BIN}`, "--json"]);
      const agents = await fs.readFile(path.join(dir, "AGENTS.md"), "utf-8").catch(() => "");
      if (!agents.includes("<!-- dsmith:ds:start -->")) throw new Error(`dsmith 조건 템플릿의 AGENTS.md에 DS 섹션이 없습니다: ${dir}`);
    }
    return dir;
  } catch (e) {
    await fs.rm(dir, { recursive: true, force: true });
    throw e;
  }
}

function git(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "git",
      ["-c", "user.name=dsmith-bench", "-c", "user.email=bench@dsmith.invalid", "-c", "commit.gpgsign=false", ...args],
      { cwd, env: { ...agentEnv([]), GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" }, stdio: ["ignore", "ignore", "pipe"] },
    );
    let err = "";
    child.stderr.on("data", (d: Buffer) => (err += d.toString("utf-8")));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`git ${args.join(" ")} 실패(${String(code)}): ${err.trim()}`))));
  });
}

/** 템플릿을 새 mkdtemp로 복사 → git init -b main, add -A, commit "bench base". 반환: 복사본 경로 */
export async function makeRunCopy(template: string): Promise<string> {
  const dir = await mkTmp("dsmith-bench-run-");
  try {
    await fs.cp(template, dir, { recursive: true });
    await assertNoHarness(dir);
    await git(dir, ["init", "-q", "-b", "main"]);
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-q", "-m", "bench base"]);
    return dir;
  } catch (e) {
    await fs.rm(dir, { recursive: true, force: true });
    throw e;
  }
}

/** claude → "claude-code", codex → "codex", 그 밖 → "agents-md" (명령 첫 단어 기준) */
export function defaultInstallTool(agentCmd: string): string {
  const first = path.basename(agentCmd.trim().split(/\s+/)[0] ?? "");
  if (first === "claude") return "claude-code";
  if (first === "codex") return "codex";
  return "agents-md";
}
