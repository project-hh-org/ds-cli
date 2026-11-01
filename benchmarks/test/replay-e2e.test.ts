import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CLI_BIN, MONOREPO_ROOT } from "../src/base.js";
import { parseBenchArgs, planBench, runBench, summaryLines, type BenchArgs } from "../src/run.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(here, "fixtures/fake-agent.mjs");
const REPLAY = path.join(MONOREPO_ROOT, "benchmarks/replay/legacy-demo");
const PROMPTS = ["01-form", "06-badge", "12-pagination"];

const args = (argv: string[]): BenchArgs => parseBenchArgs(argv);

describe("replay (합성 산출물, 네트워크·에이전트 없음)", () => {
  it("3프롬프트 × 2조건 → 실행 6개, 숫자 고정, 두 번 실행해도 JSON 동일", async () => {
    const a = args(["--replay", REPLAY, "--prompts", PROMPTS.join(","), "--date", "2026-11-01"]);
    const r1 = await runBench(a);
    const r2 = await runBench(a);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));

    expect(r1).toMatchObject({ version: 1, date: "2026-11-01", startedAt: null, repo: "legacy-demo", mode: "replay", repeat: 1, timeoutSec: null, conditions: ["baseline", "dsmith"] });
    expect(r1.agent).toEqual({ command: null, version: null, installTool: null, models: [] });
    expect(r1.base).toMatchObject({ tokens: 14, dsComponents: 6 });
    expect(r1.base.snapshotSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(r1.prompts.map((p) => p.id)).toEqual(PROMPTS);

    expect(r1.runs).toHaveLength(6);
    expect(r1.runs.map((r) => `${r.prompt}/${r.condition}/${r.rep}/${r.status}`)).toEqual([
      "01-form/baseline/1/replay",
      "01-form/dsmith/1/replay",
      "06-badge/baseline/1/replay",
      "06-badge/dsmith/1/replay",
      "12-pagination/baseline/1/replay",
      "12-pagination/dsmith/1/replay",
    ]);
    expect(r1.runs.every((r) => r.score.expectedFile)).toBe(true);

    const base = r1.aggregate.baseline!;
    const ds = r1.aggregate.dsmith!;
    expect(base).toEqual({
      runs: 3, okRuns: 3, failedRuns: 0, missingExpected: 0, harnessPathSeen: 0,
      token: 1, knownToken: 0, hardcoded: 4, replaceable: 2, tailwindDefault: 46, dynamic: 1,
      nonDs: 1, deprecated: 0, dsComponentUses: 0, parseFailed: 0, files: 3,
      compliance: 0.2, tokenShareAll: 0.0196, costUsd: null, turns: null,
    });
    expect(ds).toEqual({
      runs: 3, okRuns: 3, failedRuns: 0, missingExpected: 0, harnessPathSeen: 0,
      token: 20, knownToken: 19, hardcoded: 1, replaceable: 1, tailwindDefault: 0, dynamic: 1,
      nonDs: 0, deprecated: 0, dsComponentUses: 4, parseFailed: 0, files: 3,
      compliance: 0.9524, tokenShareAll: 0.9524, costUsd: null, turns: null,
    });
    // 불변식
    expect(base.compliance!).toBeLessThan(ds.compliance!);
    expect(ds.token - ds.knownToken).toBe(1); // 지어낸 var(--color-brand) 하나
    expect(base.nonDs).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it("없는 프롬프트 디렉터리는 status missing, 기대 파일 없음으로 센다", async () => {
    const r = await runBench(args(["--replay", REPLAY, "--prompts", "02-modal", "--conditions", "dsmith", "--date", "2026-11-01"]));
    expect(r.runs).toHaveLength(1);
    expect(r.runs[0]).toMatchObject({ prompt: "02-modal", status: "missing" });
    expect(r.aggregate.dsmith).toMatchObject({ runs: 1, okRuns: 0, failedRuns: 1, missingExpected: 1, token: 0, compliance: null });
  }, 60_000);

  it("알 수 없는 프롬프트 id는 Error", async () => {
    await expect(runBench(args(["--replay", REPLAY, "--prompts", "99-nope"]))).rejects.toThrow(/알 수 없는 프롬프트 id/);
  });

  it("--out을 주면 결과 JSON을 쓰고, 요약 줄은 조건별 준수율을 담는다", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-bench-e2e-out-"));
    try {
      const out = path.join(dir, "sub/result.json");
      const r = await runBench(args(["--replay", REPLAY, "--prompts", "06-badge", "--date", "2026-11-01", "--out", out]));
      expect(JSON.parse(fs.readFileSync(out, "utf-8"))).toEqual(JSON.parse(JSON.stringify(r)));
      expect(fs.readFileSync(out, "utf-8").endsWith("}\n")).toBe(true);
      expect(summaryLines(r).join("\n")).toMatch(/baseline[\s\S]*dsmith/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("--dry-run 계획: 아무것도 실행하지 않고 수만 센다", async () => {
    const lines = await planBench(args(["--agent", "node x.mjs", "--repeat", "2", "--prompts", "06-badge,12-pagination", "--date", "2026-11-01", "--dry-run"]));
    expect(lines.join("\n")).toContain("실행 수: 8");
    expect(lines.join("\n")).toContain("agents-md");
    expect(lines.join("\n")).toContain("2026-11-01-legacy-demo.json");
    // 프롬프트는 id 순으로 센다
    expect(lines.join("\n")).toContain("06-badge, 12-pagination");
  });
});

interface FakeEnv {
  cwd: string;
  mode: string;
  entries: string[];
  agentsMd: string | null;
  hasDsmithDir: boolean;
  hasCatalog: boolean;
  hasBenchmarksDir: boolean;
  mcp: { mcpServers: { dsmith: { command: string; args: string[] } } } | null;
  claudeEnvKeys: number;
}

describe("가짜 에이전트 e2e (--agent)", () => {
  let outRoot: string;
  let privateTmp: string;
  let prevTmp: string | undefined;
  const leftovers = (): string[] => fs.readdirSync(privateTmp).filter((n) => n.startsWith("dsmith-bench-"));

  beforeAll(() => {
    outRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-bench-e2e-out-")));
    privateTmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-bench-e2e-tmp-")));
    prevTmp = process.env.TMPDIR;
    process.env.TMPDIR = privateTmp; // 이 파일의 복사본만 여기에 생기게 해서 잔여물을 단언한다
  });
  afterAll(() => {
    if (prevTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = prevTmp;
    fs.rmSync(outRoot, { recursive: true, force: true });
    fs.rmSync(privateTmp, { recursive: true, force: true });
  });

  const fakeArgs = (out: string, extra: string[] = []): BenchArgs =>
    args(["--agent", `${process.execPath} ${FAKE}`, "--install-tool", "claude-code", "--out", out, "--prompts", "06-badge,01-form", "--date", "2026-11-01", ...extra]);
  const transcript = (out: string, condition: string, id: string): FakeEnv =>
    JSON.parse(fs.readFileSync(path.join(path.dirname(out), "result", "transcripts", condition, `${id}-1.jsonl`), "utf-8").split("\n")[0] ?? "{}") as FakeEnv;

  it("조건별 격리·기록·replay 재채점·정리", async () => {
    const out = path.join(outRoot, "result.json");
    const lines: string[] = [];
    process.env.CLAUDE_LEAK_PROBE = "1";
    let result;
    try {
      result = await runBench(fakeArgs(out), (l) => lines.push(l));
    } finally {
      delete process.env.CLAUDE_LEAK_PROBE;
    }

    expect(result.mode).toBe("agent");
    expect(result.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.agent).toMatchObject({ command: `${process.execPath} ${FAKE}`, installTool: "claude-code", models: ["fake-model"] });
    expect(result.timeoutSec).toBe(600);
    expect(result.runs.map((r) => `${r.prompt}/${r.condition}/${r.status}`)).toEqual([
      "01-form/baseline/ok",
      "01-form/dsmith/ok",
      "06-badge/baseline/ok",
      "06-badge/dsmith/ok",
    ]);
    expect(result.runs.every((r) => r.exitCode === 0 && r.agentMeta?.costUsd === 0.001 && !r.harnessPathSeen && r.score.expectedFile)).toBe(true);
    expect(JSON.parse(fs.readFileSync(out, "utf-8"))).toEqual(JSON.parse(JSON.stringify(result)));

    // 조건별 환경(가짜 에이전트가 본 cwd)
    for (const id of ["06-badge", "01-form"]) {
      const b = transcript(out, "baseline", id);
      const d = transcript(out, "dsmith", id);
      expect(b.mode).toBe("baseline");
      expect(d.mode).toBe("dsmith");
      // baseline: dsmith 흔적 없음
      expect(b.agentsMd).toBeNull();
      expect(b.hasDsmithDir).toBe(false);
      expect(b.mcp).toBeNull();
      expect(b.entries).not.toContain(".mcp.json");
      expect(b.entries).not.toContain(".claude");
      // dsmith: AGENTS.md DS 마커 + .mcp.json(node, args[0]=CLI_BIN) + 카탈로그
      expect(d.agentsMd).toContain("<!-- dsmith:ds:start -->");
      expect(d.mcp?.mcpServers.dsmith.command).toBe("node");
      expect(d.mcp?.mcpServers.dsmith.args[0]).toBe(CLI_BIN);
      expect(d.hasCatalog).toBe(true);
      // 공통: 복사본은 tmp 아래·모노레포 밖, benchmarks/ 없음, CLAUDE* 환경 변수 없음
      for (const e of [b, d]) {
        expect(e.cwd.startsWith(privateTmp)).toBe(true);
        expect(path.relative(MONOREPO_ROOT, e.cwd).startsWith("..")).toBe(true);
        expect(e.hasBenchmarksDir).toBe(false);
        expect(e.claudeEnvKeys).toBe(0);
      }
      expect(b.cwd).not.toBe(d.cwd);
    }

    // 산출물(replay 배치)
    const record = path.join(outRoot, "result/outputs");
    for (const c of ["baseline", "dsmith"]) {
      for (const [id, file] of [["06-badge", "src/components/StockStatusBadge.tsx"], ["01-form", "src/components/ProductForm.tsx"]] as const) {
        expect(fs.existsSync(path.join(record, c, id, "1/files", file))).toBe(true);
        expect(JSON.parse(fs.readFileSync(path.join(record, c, id, "1/run.json"), "utf-8"))).toMatchObject({ status: "ok", exitCode: 0, agentMeta: { costUsd: 0.001, turns: 1 }, harnessPathSeen: false, deleted: [] });
      }
    }
    // 점수: baseline은 로컬 Button(DS 외) + 하드코딩, dsmith는 DS import + 토큰
    expect(result.aggregate.baseline).toMatchObject({ runs: 2, okRuns: 2, nonDs: 2, hardcoded: 2, token: 0, dsComponentUses: 0, costUsd: 0.002, turns: 2 });
    expect(result.aggregate.dsmith).toMatchObject({ runs: 2, nonDs: 0, hardcoded: 0, token: 4, knownToken: 4, dsComponentUses: 2, compliance: 1 });

    // 기록한 산출물을 --replay로 다시 채점하면 같은 집계
    const again = await runBench(args(["--replay", record, "--prompts", "06-badge,01-form", "--date", "2026-11-01"]));
    expect(again.mode).toBe("replay");
    expect(again.aggregate).toEqual(result.aggregate);
    expect(again.runs.map((r) => r.score)).toEqual(result.runs.map((r) => r.score));

    // keep: false → 복사본·템플릿·베이스가 남지 않는다
    expect(leftovers()).toEqual([]);
  }, 120_000);

  it("종료 코드 ≠ 0 → agent-error, 산출물은 채점된다", async () => {
    const out = path.join(outRoot, "exit/result.json");
    process.env.FAKE_AGENT_EXIT = "3";
    try {
      const r = await runBench(fakeArgs(out, ["--conditions", "dsmith", "--prompts", "06-badge", "--pass-env", "FAKE_AGENT_EXIT"]));
      expect(r.runs).toHaveLength(1);
      expect(r.runs[0]).toMatchObject({ status: "agent-error", exitCode: 3 });
      expect(r.runs[0]?.score.expectedFile).toBe(true);
      expect(r.runs[0]?.score.totals.token).toBeGreaterThan(0);
      expect(r.aggregate.dsmith).toMatchObject({ okRuns: 0, failedRuns: 1 });
    } finally {
      delete process.env.FAKE_AGENT_EXIT;
    }
    expect(leftovers()).toEqual([]);
  }, 120_000);

  it("timeout → status timeout, 변경 없음(기대 파일 없음)", async () => {
    const out = path.join(outRoot, "timeout/result.json");
    process.env.FAKE_AGENT_SLEEP_MS = "5000";
    try {
      const t0 = Date.now();
      const r = await runBench(fakeArgs(out, ["--conditions", "baseline", "--prompts", "06-badge", "--timeout", "1", "--pass-env", "FAKE_AGENT_SLEEP_MS"]));
      expect(Date.now() - t0).toBeLessThan(30_000);
      expect(r.runs[0]).toMatchObject({ status: "timeout", exitCode: null });
      expect(r.timeoutSec).toBe(1);
      expect(r.aggregate.baseline).toMatchObject({ failedRuns: 1, missingExpected: 1 });
    } finally {
      delete process.env.FAKE_AGENT_SLEEP_MS;
    }
    expect(leftovers()).toEqual([]);
  }, 120_000);

  it("stdout에 benchmarks 경로가 나오면 harnessPathSeen, --keep이면 복사본을 남기고 경로를 로그한다", async () => {
    const out = path.join(outRoot, "harness/result.json");
    const lines: string[] = [];
    const agent = `echo ${path.join(MONOREPO_ROOT, "benchmarks/src/score.ts")}`;
    const r = await runBench(args(["--agent", agent, "--install-tool", "claude-code", "--out", out, "--prompts", "06-badge", "--conditions", "dsmith", "--keep", "--date", "2026-11-01"]), (l) => lines.push(l));
    expect(r.runs[0]).toMatchObject({ status: "ok", harnessPathSeen: true });
    expect(r.aggregate.dsmith).toMatchObject({ harnessPathSeen: 1, missingExpected: 1 });
    const kept = lines.find((l) => l.includes("복사본 유지"))?.split(": ")[1];
    expect(kept).toBeDefined();
    expect(fs.existsSync(path.join(kept ?? "", ".mcp.json"))).toBe(true);
    // --keep: 실행 복사본만 남고 베이스·템플릿은 지워진다
    expect(leftovers()).toEqual([path.basename(kept ?? "")]);
    fs.rmSync(kept ?? "", { recursive: true, force: true });
  }, 120_000);
});
