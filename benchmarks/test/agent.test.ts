import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { PASS_ENV, agentEnv, agentVersion, parseAgentMeta, runAgent } from "../src/agent.js";
import { cleanupTmps, tmpDir } from "./helpers.js";

afterAll(cleanupTmps);

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/fake-agent.mjs");
const baseEnv = (): Record<string, string> => agentEnv([]);

describe("agentEnv", () => {
  it("CLAUDE* 계열을 걸러 내고 허용 목록만 남긴다", () => {
    const env = agentEnv([], { HOME: "/h", PATH: "/p", CLAUDE_CODE_SESSION_ID: "x", CLAUDECODE: "1", ANTHROPIC_API_KEY: "k", SECRET: "s" });
    expect(env).toEqual({ HOME: "/h", PATH: "/p", ANTHROPIC_API_KEY: "k" });
    expect(Object.keys(env).some((k) => k.startsWith("CLAUDE"))).toBe(false);
  });

  it("extra는 있을 때만 넘기고, CLAUDE* 이름은 Error", () => {
    expect(agentEnv(["FAKE_X", "FAKE_Y"], { FAKE_X: "1", PATH: "/p" })).toEqual({ PATH: "/p", FAKE_X: "1" });
    expect(() => agentEnv(["CLAUDE_X"])).toThrow(/넘길 수 없습니다/);
    expect(() => agentEnv(["CLAUDECODE"])).toThrow();
  });

  it("PASS_ENV 고정", () => {
    expect([...PASS_ENV]).toEqual(["HOME", "PATH", "LANG", "LC_ALL", "TMPDIR", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]);
  });
});

describe("runAgent", () => {
  const cwd = (): string => tmpDir("dsmith-bench-agent-");

  it("프롬프트를 stdin으로 넘기고 stdout을 받는다", async () => {
    const r = await runAgent("cat", "안녕", { cwd: cwd(), env: baseEnv(), timeoutMs: 5000 });
    expect(r).toMatchObject({ stdout: "안녕", exitCode: 0, timedOut: false, stdoutTruncated: false });
  });

  it("종료 코드와 stderr 꼬리를 남긴다", async () => {
    const r = await runAgent("echo oops >&2; exit 3", "", { cwd: cwd(), env: baseEnv(), timeoutMs: 5000 });
    expect(r.exitCode).toBe(3);
    expect(r.stderrTail).toContain("oops");
  });

  it("cwd에서 실행한다", async () => {
    const dir = cwd();
    const r = await runAgent("pwd", "", { cwd: dir, env: baseEnv(), timeoutMs: 5000 });
    expect(r.stdout.trim()).toBe(dir);
  });

  it("timeout이면 1초 안에 돌아오고 손자 프로세스까지 죽는다", async () => {
    const dir = cwd();
    const pidFile = path.join(dir, "pid");
    const t0 = Date.now();
    const r = await runAgent(`sh -c "sleep 30 & echo \\$! > ${pidFile}; wait"`, "", { cwd: dir, env: baseEnv(), timeoutMs: 300 });
    expect(r.timedOut).toBe(true);
    expect(Date.now() - t0).toBeLessThan(2000);
    const pid = Number(fs.readFileSync(pidFile, "utf-8").trim());
    expect(pid).toBeGreaterThan(0);
    await new Promise((res) => setTimeout(res, 100));
    // 죽었거나(ESRCH) 좀비(Z — 부모가 없어 수거되지 않은 것)면 살아 있지 않은 것
    let state = "gone";
    try {
      state = /^\d+ \(.*\) (\w)/.exec(fs.readFileSync(`/proc/${pid}/stat`, "utf-8"))?.[1] ?? "gone";
    } catch {
      // /proc에 없음
    }
    expect(["gone", "Z"]).toContain(state);
  });

  it("stdout이 한도를 넘으면 자르고 표시한다", async () => {
    const r = await runAgent(`${process.execPath} -e "process.stdout.write('x'.repeat(33*1024*1024))"`, "", { cwd: cwd(), env: baseEnv(), timeoutMs: 20_000 });
    expect(r.stdoutTruncated).toBe(true);
    expect(r.stdout.length).toBe(32 * 1024 * 1024);
  }, 30_000);

  it("없는 명령은 던지지 않고 종료 코드로 기록한다", async () => {
    const r = await runAgent("definitely-not-a-command-xyz", "", { cwd: cwd(), env: baseEnv(), timeoutMs: 5000 });
    expect(r.exitCode).not.toBe(0);
  });

  it("가짜 에이전트: 파일을 쓰고 stream-json 줄을 낸다 / 환경에 CLAUDE* 없음", async () => {
    const dir = cwd();
    process.env.CLAUDE_PROBE_FOR_TEST = "1";
    try {
      const r = await runAgent(`${process.execPath} ${FAKE}`, "src/components/Foo.tsx 를 만들어 주세요.", { cwd: dir, env: agentEnv([]), timeoutMs: 10_000 });
      expect(r.exitCode).toBe(0);
      expect(fs.existsSync(path.join(dir, "src/components/Foo.tsx"))).toBe(true);
      const env = JSON.parse(r.stdout.split("\n")[0] ?? "{}") as { claudeEnvKeys: number; mode: string };
      expect(env.claudeEnvKeys).toBe(0);
      expect(env.mode).toBe("baseline");
      expect(parseAgentMeta(r.stdout)).toMatchObject({ costUsd: 0.001, turns: 1, models: ["fake-model"] });
    } finally {
      delete process.env.CLAUDE_PROBE_FOR_TEST;
    }
  });

  it("가짜 에이전트 FAKE_AGENT_SLEEP_MS + 짧은 timeout → timedOut", async () => {
    const r = await runAgent(`${process.execPath} ${FAKE}`, "", { cwd: cwd(), env: agentEnv(["FAKE_AGENT_SLEEP_MS"], { ...process.env, FAKE_AGENT_SLEEP_MS: "5000" }), timeoutMs: 400 });
    expect(r.timedOut).toBe(true);
  });
});

describe("parseAgentMeta", () => {
  // 부록 D.1.8 모양의 결과 줄
  const RESULT = {
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: 4,
    total_cost_usd: 0.0639,
    duration_ms: 16400,
    modelUsage: { "claude-sonnet-5-5": { costUSD: 0.0638 }, "claude-haiku-5-5": { costUSD: 0.0001 } },
    permission_denials: [],
  };
  const EXPECTED = { costUsd: 0.0639, turns: 4, subtype: "success", models: ["claude-haiku-5-5", "claude-sonnet-5-5"], permissionDenials: 0, isError: false };

  it("JSON 한 개(--output-format json)", () => {
    expect(parseAgentMeta(JSON.stringify(RESULT))).toEqual(EXPECTED);
  });

  it("JSONL 마지막 줄(stream-json)", () => {
    const lines = [{ type: "system", subtype: "init", cwd: "/x" }, { type: "assistant", message: {} }, RESULT];
    expect(parseAgentMeta(lines.map((l) => JSON.stringify(l)).join("\n"))).toEqual(EXPECTED);
  });

  it("앞에 비JSON 줄이 섞여도 읽는다 / 결과가 둘이면 마지막", () => {
    const text = ["warning: something", JSON.stringify({ ...RESULT, total_cost_usd: 1 }), "not json {", JSON.stringify(RESULT), ""].join("\n");
    expect(parseAgentMeta(text)).toEqual(EXPECTED);
  });

  it("type이 없어도 total_cost_usd가 있으면 읽고, 필드가 없으면 그 키는 빠진다", () => {
    expect(parseAgentMeta(JSON.stringify({ total_cost_usd: 0.5 }))).toEqual({ costUsd: 0.5 });
    expect(parseAgentMeta(JSON.stringify({ type: "result", permission_denials: ["a", "b"], is_error: true, subtype: "error_max_turns" }))).toEqual({
      subtype: "error_max_turns",
      permissionDenials: 2,
      isError: true,
    });
  });

  it("읽을 수 없으면 null", () => {
    expect(parseAgentMeta("그냥 텍스트")).toBeNull();
    expect(parseAgentMeta("")).toBeNull();
    expect(parseAgentMeta('{"type":"assistant"}')).toBeNull();
  });
});

describe("agentVersion", () => {
  it("첫 단어 --version의 첫 줄, 실패하면 null", async () => {
    expect(await agentVersion("node -p 1", baseEnv())).toMatch(/^v\d+\./);
    expect(await agentVersion("definitely-not-a-command-xyz --foo", baseEnv())).toBeNull();
    expect(await agentVersion("", baseEnv())).toBeNull();
  });
});
