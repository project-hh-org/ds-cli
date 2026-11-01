import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { localDate } from "@dsmith-dev/core";
import { agentEnv, agentVersion, parseAgentMeta, runAgent } from "./agent.js";
import {
  CLI_BIN,
  MONOREPO_ROOT,
  REPOS,
  defaultInstallTool,
  makeRunCopy,
  prepareBase,
  prepareCondition,
  type RepoName,
} from "./base.js";
import { collectChanges, readReplay, writeOutputs } from "./collect.js";
import { CONDITIONS, type Aggregate, type BenchResult, type Condition, type RunRecord } from "./model.js";
import { loadPrompts, type Prompt } from "./prompts.js";
import { aggregate, scoreRun } from "./score.js";

/** `--agent "claude -p"` 약식은 결정 5의 전체 명령(부록 D.1)으로 펼친다. 그 밖의 문자열은 그대로 쓴다. */
export const CLAUDE_AGENT_COMMAND =
  "claude -p --output-format stream-json --verbose --model sonnet --max-turns 20 --max-budget-usd 0.5 --permission-mode acceptEdits --allowedTools mcp__dsmith --setting-sources project --no-session-persistence";

export interface BenchArgs {
  repo: RepoName;
  /** 정확히 하나: agent | replay */
  agent: string | null;
  replay: string | null;
  conditions: Condition[];
  repeat: number;
  prompts: string[] | null;
  out: string | null;
  record: string | null;
  timeoutSec: number;
  installTool: string | null;
  passEnv: string[];
  keep: boolean;
  date: string | null;
  agentVersion: string | null;
  dryRun: boolean;
}

const USAGE = `사용법: node dist/run.js (--agent "<명령>" | --replay <디렉터리>) [옵션]
  --repo <legacy-demo|with-ds-app>   대상 레포 (기본 legacy-demo)
  --agent "<명령>"                   프롬프트를 stdin으로 받는 에이전트 명령. "claude -p"만 쓰면 결정 5의 전체 명령으로 펼침
  --replay <dir>                     <dir>/<조건>/<프롬프트 id>/<반복>/{files/…,run.json} 산출물을 채점만 한다(에이전트 호출 없음)
  --conditions baseline,dsmith       기본: 둘 다
  --repeat <1..10>                   기본 1
  --prompts <id,id>                  기본: 12개 전부
  --out <결과.json>                  agent 기본 benchmarks/results/<date>-<repo>.json, replay 기본: 파일 없이 요약만 출력
  --record <dir>                     agent 산출물 디렉터리 (기본 <out 확장자 뺀 경로>/outputs)
  --timeout <초>                     에이전트 한 번의 제한 (기본 600)
  --install-tool <도구>              dsmith 조건의 install --tool (기본: 에이전트 명령에서 추정)
  --pass-env <NAME>                  에이전트에 추가로 넘길 환경 변수 (반복 가능, CLAUDE* 불가)
  --keep                             실행 복사본을 지우지 않고 경로를 출력
  --date <YYYY-MM-DD>                결과의 날짜 덮어쓰기
  --agent-version <문자열>           결과의 에이전트 버전 덮어쓰기(replay에서 기록용)
  --dry-run                          계획만 출력하고 아무것도 실행하지 않음`;

const splitList = (s: string): string[] =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x !== "");

/** node:util parseArgs. 잘못된 입력은 사용법을 담은 Error. 맨 앞의 `--`(pnpm 전달)는 무시한다. */
export function parseBenchArgs(argv: string[]): BenchArgs {
  const fail = (why: string): never => {
    throw new Error(`${why}\n${USAGE}`);
  };
  const rest = argv[0] === "--" ? argv.slice(1) : argv;
  let values;
  try {
    ({ values } = parseArgs({
      args: rest,
      strict: true,
      allowPositionals: false,
      options: {
        repo: { type: "string" },
        agent: { type: "string" },
        replay: { type: "string" },
        conditions: { type: "string" },
        repeat: { type: "string" },
        prompts: { type: "string" },
        out: { type: "string" },
        record: { type: "string" },
        timeout: { type: "string" },
        "install-tool": { type: "string" },
        "pass-env": { type: "string", multiple: true },
        keep: { type: "boolean" },
        date: { type: "string" },
        "agent-version": { type: "string" },
        "dry-run": { type: "boolean" },
      },
    }));
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }

  const repo = values.repo ?? "legacy-demo";
  if (!Object.hasOwn(REPOS, repo)) fail(`모르는 --repo: ${repo} (있는 것: ${Object.keys(REPOS).join(", ")})`);
  const agent = values.agent === undefined ? null : values.agent.trim();
  const replay = values.replay ?? null;
  if (agent !== null && replay !== null) fail("--agent와 --replay는 함께 쓸 수 없습니다");
  if (agent === null && replay === null) fail("--agent 또는 --replay 중 하나가 필요합니다");
  if (agent === "") fail("--agent 명령이 비어 있습니다");

  const conditions: Condition[] = [];
  for (const c of splitList(values.conditions ?? CONDITIONS.join(","))) {
    const known = CONDITIONS.find((k) => k === c);
    if (known === undefined) return fail(`모르는 --conditions 값: ${c} (있는 것: ${CONDITIONS.join(", ")})`);
    if (!conditions.includes(known)) conditions.push(known);
  }
  if (conditions.length === 0) fail("--conditions가 비어 있습니다");
  conditions.sort((a, b) => CONDITIONS.indexOf(a) - CONDITIONS.indexOf(b));

  const repeat = values.repeat === undefined ? 1 : Number(values.repeat);
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 10) fail(`--repeat는 1..10 정수여야 합니다: ${values.repeat ?? ""}`);
  const timeoutSec = values.timeout === undefined ? 600 : Number(values.timeout);
  if (!Number.isFinite(timeoutSec) || timeoutSec <= 0) fail(`--timeout은 양수(초)여야 합니다: ${values.timeout ?? ""}`);
  const date = values.date ?? null;
  if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(`--date는 YYYY-MM-DD 형식이어야 합니다: ${date}`);
  const prompts = values.prompts === undefined ? null : splitList(values.prompts);
  if (prompts !== null && prompts.length === 0) fail("--prompts가 비어 있습니다");
  const passEnv = values["pass-env"] ?? [];
  for (const name of passEnv) agentEnv([name], {}); // CLAUDE* 이면 Error

  return {
    repo: repo as RepoName,
    agent: agent === "claude -p" ? CLAUDE_AGENT_COMMAND : agent,
    replay,
    conditions,
    repeat,
    prompts,
    out: values.out ?? null,
    record: values.record ?? null,
    timeoutSec,
    installTool: values["install-tool"] ?? null,
    passEnv,
    keep: values.keep === true,
    date,
    agentVersion: values["agent-version"] ?? null,
    dryRun: values["dry-run"] === true,
  };
}

const PROMPTS_DIR = path.join(MONOREPO_ROOT, "benchmarks/prompts");

/** --prompts 순서와 무관하게 id 순(결정적 출력). 중복 id는 한 번만. */
async function promptsFor(ids: string[] | null): Promise<Prompt[]> {
  const loaded = await loadPrompts(PROMPTS_DIR, ids ?? undefined);
  const byId = new Map(loaded.map((p) => [p.id, p]));
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function effectiveOut(args: BenchArgs, date: string): string | null {
  if (args.out !== null) return path.resolve(args.out);
  if (args.agent !== null) return path.join(MONOREPO_ROOT, "benchmarks/results", `${date}-${args.repo}.json`);
  return null;
}

function effectiveRecord(args: BenchArgs, out: string | null): string | null {
  if (args.record !== null) return path.resolve(args.record);
  if (out === null) return null;
  return path.join(path.dirname(out), path.basename(out, path.extname(out)), "outputs");
}

/** `--dry-run`: 실행 계획 줄들. 아무 것도 준비·실행하지 않는다. */
export async function planBench(args: BenchArgs): Promise<string[]> {
  const date = args.date ?? localDate(new Date());
  const prompts = await promptsFor(args.prompts);
  const out = effectiveOut(args, date);
  const record = args.agent !== null ? effectiveRecord(args, out) : null;
  const total = prompts.length * args.conditions.length * args.repeat;
  return [
    `모드: ${args.agent !== null ? "agent" : "replay"} · 레포: ${args.repo} (${REPOS[args.repo]})`,
    args.agent !== null ? `에이전트 명령: ${args.agent}` : `replay 디렉터리: ${path.resolve(args.replay ?? "")}`,
    ...(args.agent !== null ? [`install 도구: ${args.installTool ?? defaultInstallTool(args.agent)} · 제한시간 ${args.timeoutSec}초 · 넘기는 환경 변수: ${Object.keys(agentEnv(args.passEnv)).join(", ")}`] : []),
    `조건: ${args.conditions.join(", ")} · 반복: ${args.repeat} · 프롬프트 ${prompts.length}개: ${prompts.map((p) => p.id).join(", ")}`,
    `실행 수: ${total} (순차)`,
    `결과 JSON: ${out ?? "(파일 없음 — 요약만 출력)"}`,
    ...(record !== null ? [`산출물(replay 배치): ${record}`] : []),
    `날짜: ${date}`,
  ];
}

function git(cwd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, encoding: "utf-8" }, (err, stdout) => resolve(err === null ? stdout.trim() : null));
  });
}

async function dsmithInfo(): Promise<BenchResult["dsmith"]> {
  const pkg: unknown = JSON.parse(await fs.readFile(path.join(MONOREPO_ROOT, "packages/cli/package.json"), "utf-8"));
  const version = typeof pkg === "object" && pkg !== null && "version" in pkg && typeof pkg.version === "string" ? pkg.version : "unknown";
  const commit = await git(MONOREPO_ROOT, ["rev-parse", "HEAD"]);
  return { version, commit: commit === "" ? null : commit };
}

/**
 * prepareBase → (agent) 조건별 템플릿 → 프롬프트 × 조건 × 반복 순차 실행 → 채점 → 집계.
 * 에이전트 실패는 던지지 않고 기록한다(산출물은 그래도 채점). 베이스·템플릿은 finally에서 지운다.
 */
export async function runBench(args: BenchArgs, log: (line: string) => void = () => undefined): Promise<BenchResult> {
  const date = args.date ?? localDate(new Date());
  const mode = args.agent !== null ? "agent" : "replay";
  const prompts = await promptsFor(args.prompts);
  const out = effectiveOut(args, date);
  const record = mode === "agent" ? effectiveRecord(args, out) : null;
  const replayDir = args.replay === null ? null : path.resolve(args.replay);
  const env = agentEnv(args.passEnv);
  const installTool = args.agent !== null ? (args.installTool ?? defaultInstallTool(args.agent)) : args.installTool;
  const startedAt = mode === "agent" ? new Date().toISOString() : null;
  const dsmith = await dsmithInfo();
  const version = args.agentVersion ?? (args.agent !== null ? await agentVersion(args.agent, env) : null);

  log(`베이스 준비: ${args.repo}`);
  const base = await prepareBase(args.repo);
  const templates = new Map<Condition, string>();
  const runs: RunRecord[] = [];
  try {
    if (args.agent !== null) {
      for (const c of args.conditions) {
        log(`조건 템플릿 준비: ${c}`);
        templates.set(c, await prepareCondition(base, c, installTool ?? "agents-md"));
      }
    }
    const harnessDir = path.join(MONOREPO_ROOT, "benchmarks");
    for (const prompt of prompts) {
      for (const condition of args.conditions) {
        for (let rep = 1; rep <= args.repeat; rep += 1) {
          const label = `${prompt.id} · ${condition} · #${rep}`;
          const scoreOf = (changes: Parameters<typeof scoreRun>[0]["changes"]) =>
            scoreRun({ root: base.dir, snapshot: base.snapshot, matchers: base.matchers, changes, expectedFile: prompt.file });

          if (args.agent === null) {
            const r = await readReplay(replayDir ?? "", base, condition, prompt.id, rep);
            const rec: RunRecord = {
              prompt: prompt.id,
              condition,
              rep,
              status: r.run.status ?? "replay",
              exitCode: r.run.exitCode ?? null,
              durationMs: r.run.durationMs ?? null,
              agentMeta: r.run.agentMeta ?? null,
              harnessPathSeen: r.run.harnessPathSeen ?? false,
              score: scoreOf(r.changes),
            };
            runs.push(rec);
            log(`${label}: ${rec.status}`);
            continue;
          }

          const template = templates.get(condition);
          if (template === undefined) throw new Error(`조건 템플릿이 없습니다: ${condition}`);
          const copy = await makeRunCopy(template);
          try {
            log(`${label}: 실행`);
            const res = await runAgent(args.agent, prompt.text, { cwd: copy, env, timeoutMs: args.timeoutSec * 1000 });
            const changes = await collectChanges(copy);
            const status: RunRecord["status"] = res.timedOut ? "timeout" : res.exitCode !== 0 ? "agent-error" : "ok";
            const harnessPathSeen = res.stdout.includes(harnessDir);
            const meta = parseAgentMeta(res.stdout);
            if (record !== null) {
              const transcript = path.join(path.dirname(record), "transcripts", condition, `${prompt.id}-${rep}.jsonl`);
              await fs.mkdir(path.dirname(transcript), { recursive: true });
              await fs.writeFile(transcript, res.stdout);
            }
            const meta0 = { status, exitCode: res.exitCode, durationMs: res.durationMs, agentMeta: meta, harnessPathSeen };
            if (record !== null) await writeOutputs(record, condition, prompt.id, rep, changes, meta0);
            runs.push({ prompt: prompt.id, condition, rep, ...meta0, score: scoreOf(changes) });
            log(`${label}: ${status} (${Math.round(res.durationMs / 100) / 10}s, 변경 ${changes.length}개${meta?.costUsd !== undefined ? `, $${meta.costUsd}` : ""})`);
            if (res.exitCode !== 0 && res.stderrTail.trim() !== "") log(`  stderr: ${res.stderrTail.trim().split("\n").slice(-3).join(" | ")}`);
          } finally {
            if (args.keep) log(`  복사본 유지: ${copy}`);
            else await fs.rm(copy, { recursive: true, force: true });
          }
        }
      }
    }

    const agg: Partial<Record<Condition, Aggregate>> = {};
    for (const c of args.conditions) agg[c] = aggregate(runs.filter((r) => r.condition === c));
    const models = [...new Set(runs.flatMap((r) => r.agentMeta?.models ?? []))].sort();
    const result: BenchResult = {
      version: 1,
      date,
      startedAt,
      repo: args.repo,
      mode,
      agent: { command: args.agent, version, installTool: mode === "agent" ? installTool : null, models },
      dsmith,
      base: { tokens: base.snapshot.tokens.length, dsComponents: base.snapshot.ds.components.length, snapshotSha256: base.snapshotSha256 },
      prompts: prompts.map((p: Prompt) => ({ id: p.id, file: p.file, sha256: p.sha256 })),
      conditions: args.conditions,
      repeat: args.repeat,
      timeoutSec: mode === "agent" ? args.timeoutSec : null,
      runs,
      aggregate: agg,
    };
    if (out !== null) {
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.writeFile(out, `${JSON.stringify(result, null, 2)}\n`);
      log(`결과 JSON: ${out}`);
    }
    return result;
  } finally {
    await fs.rm(base.dir, { recursive: true, force: true });
    for (const t of templates.values()) await fs.rm(t, { recursive: true, force: true });
  }
}

const pct = (v: number | null): string => (v === null ? "-" : `${(v * 100).toFixed(1)}%`);

/** 사람이 읽는 짧은 요약(표준 출력용). 보고서(md)는 report.ts 몫. */
export function summaryLines(result: BenchResult): string[] {
  const lines = [`${result.repo} · ${result.mode} · ${result.date} · 프롬프트 ${result.prompts.length}개 × 반복 ${result.repeat}`];
  for (const c of result.conditions) {
    const a = result.aggregate[c];
    if (a === undefined) continue;
    lines.push(
      `${c.padEnd(8)} 준수율 ${pct(a.compliance)} (token ${a.token} / hardcoded ${a.hardcoded}) · tailwind-default ${a.tailwindDefault} · knownToken ${a.knownToken} · nonDs ${a.nonDs} · DS 사용 ${a.dsComponentUses} · 실행 ${a.runs} (실패 ${a.failedRuns}, 기대 파일 없음 ${a.missingExpected})${a.costUsd !== null ? ` · $${a.costUsd}` : ""}`,
    );
  }
  return lines;
}

async function main(): Promise<void> {
  const args = parseBenchArgs(process.argv.slice(2));
  if (args.dryRun) {
    process.stdout.write(`${(await planBench(args)).join("\n")}\n`);
    return;
  }
  if (!(await fs.stat(CLI_BIN).then(() => true, () => false))) throw new Error(`${CLI_BIN} 이 없습니다 — 먼저 pnpm -r build 를 실행하세요`);
  const result = await runBench(args, (line) => process.stderr.write(`${line}\n`));
  process.stdout.write(`${summaryLines(result).join("\n")}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(2);
  });
}
