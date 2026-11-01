import { spawn } from "node:child_process";
import type { AgentMeta } from "./model.js";

export type { AgentMeta } from "./model.js";

/** 에이전트에 넘기는 환경 변수(있을 때만). `CLAUDE*`·`CLAUDECODE` 계열은 부모 세션을 물려받게 하므로 넘기지 않는다(결정 6). */
export const PASS_ENV: readonly string[] = ["HOME", "PATH", "LANG", "LC_ALL", "TMPDIR", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"];

const FORBIDDEN_ENV = /^CLAUDE|^CLAUDECODE/;

/** PASS_ENV ∪ extra 중 env에 있는 것만. extra에 CLAUDE* 이름이 있으면 Error. */
export function agentEnv(extra: string[], env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  for (const name of extra) {
    if (FORBIDDEN_ENV.test(name)) throw new Error(`환경 변수 ${name} 은(는) 에이전트에 넘길 수 없습니다 — CLAUDE* 계열은 부모 세션을 물려받습니다(결정 6)`);
  }
  const out: Record<string, string> = {};
  for (const name of [...PASS_ENV, ...extra]) {
    const v = env[name];
    if (v !== undefined) out[name] = v;
  }
  return out;
}

export interface AgentRun {
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  /** stdout이 한도(32MB)를 넘어 잘렸는가 */
  stdoutTruncated: boolean;
  /** stderr 마지막 4KB */
  stderrTail: string;
}

const STDOUT_MAX = 32 * 1024 * 1024;
const STDERR_TAIL = 4096;

function killGroup(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // 이미 없음
  }
}

/**
 * `sh -c <cmd>`를 cwd에서 실행(프로세스 그룹 분리). prompt를 stdin에 쓰고 닫는다.
 * timeout이면 그룹 전체를 SIGKILL하고 timedOut으로 돌려준다. 실행 실패(spawn 오류)도 던지지 않고 exitCode null + stderrTail에 기록한다.
 */
export function runAgent(cmd: string, prompt: string, opts: { cwd: string; env: Record<string, string>; timeoutMs: number }): Promise<AgentRun> {
  return new Promise((resolve) => {
    const started = Date.now();
    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    let errTail = Buffer.alloc(0);
    let timedOut = false;
    let settled = false;
    let exitCode: number | null = null;
    let grace: NodeJS.Timeout | undefined;

    const child = spawn("sh", ["-c", cmd], { cwd: opts.cwd, env: opts.env, detached: true, stdio: ["pipe", "pipe", "pipe"] });

    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(grace);
      killGroup(child.pid);
      resolve({
        exitCode,
        timedOut,
        durationMs: Date.now() - started,
        stdout: Buffer.concat(chunks).toString("utf-8"),
        stdoutTruncated: truncated,
        stderrTail: errTail.toString("utf-8"),
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child.pid);
    }, opts.timeoutMs);

    child.stdout.on("data", (d: Buffer) => {
      if (truncated) return;
      if (size + d.length > STDOUT_MAX) {
        chunks.push(d.subarray(0, STDOUT_MAX - size));
        size = STDOUT_MAX;
        truncated = true;
        return;
      }
      chunks.push(d);
      size += d.length;
    });
    child.stderr.on("data", (d: Buffer) => {
      errTail = Buffer.concat([errTail, d]);
      if (errTail.length > STDERR_TAIL) errTail = errTail.subarray(errTail.length - STDERR_TAIL);
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(prompt);
    child.on("error", (e) => {
      errTail = Buffer.from(`spawn 실패: ${e.message}`);
      finish();
    });
    child.on("exit", (code) => {
      exitCode = code;
      // 손자 프로세스가 파이프를 쥐고 있어도 1초 안에 끝낸다
      grace = setTimeout(finish, 1000);
    });
    child.on("close", finish);
  });
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function metaOf(o: Record<string, unknown>): AgentMeta {
  const meta: AgentMeta = {};
  if (typeof o.total_cost_usd === "number") meta.costUsd = o.total_cost_usd;
  if (typeof o.num_turns === "number") meta.turns = o.num_turns;
  if (typeof o.subtype === "string") meta.subtype = o.subtype;
  if (isRecord(o.modelUsage)) meta.models = Object.keys(o.modelUsage).sort();
  if (Array.isArray(o.permission_denials)) meta.permissionDenials = o.permission_denials.length;
  if (typeof o.is_error === "boolean") meta.isError = o.is_error;
  return meta;
}

/**
 * stdout이 JSON 한 개(`--output-format json`)거나 JSONL(stream-json)일 때, `type: "result"`(또는 total_cost_usd가 있는) 마지막 객체에서 메타를 읽는다.
 * 못 읽으면 null(에이전트 종류와 무관).
 */
export function parseAgentMeta(stdout: string): AgentMeta | null {
  const candidates: unknown[] = [];
  const whole = stdout.trim();
  if (whole === "") return null;
  try {
    candidates.push(JSON.parse(whole));
  } catch {
    for (const line of whole.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("{")) continue;
      try {
        candidates.push(JSON.parse(t));
      } catch {
        // 비JSON 줄
      }
    }
  }
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const c = candidates[i];
    if (isRecord(c) && (c.type === "result" || typeof c.total_cost_usd === "number")) return metaOf(c);
  }
  return null;
}

/** 명령 첫 단어 + " --version"(10초 제한, 같은 정리된 env). 첫 줄 trim, 실패면 null. */
export async function agentVersion(cmd: string, env: Record<string, string>): Promise<string | null> {
  const first = cmd.trim().split(/\s+/)[0] ?? "";
  if (first === "") return null;
  const r = await runAgent(`${first} --version`, "", { cwd: process.cwd(), env, timeoutMs: 10_000 });
  if (r.exitCode !== 0 || r.timedOut) return null;
  const line = r.stdout.split("\n")[0]?.trim() ?? "";
  return line === "" ? null : line;
}
