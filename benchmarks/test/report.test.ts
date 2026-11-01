import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Aggregate, BenchResult, Condition, RunRecord, RunScore } from "../src/model.js";
import { readmeLine, renderReport, reportFromFile } from "../src/report.js";

interface Counts {
  token?: number;
  knownToken?: number;
  hardcoded?: number;
  replaceable?: number;
  tailwindDefault?: number;
  dynamic?: number;
  nonDs?: number;
  dsComponentUses?: number;
  deprecated?: number;
  parseFailed?: number;
}

function score(c: Counts, expectedFile = true): RunScore {
  const totals = {
    token: c.token ?? 0,
    knownToken: c.knownToken ?? c.token ?? 0,
    hardcoded: c.hardcoded ?? 0,
    replaceable: c.replaceable ?? c.hardcoded ?? 0,
    tailwindDefault: c.tailwindDefault ?? 0,
    dynamic: c.dynamic ?? 0,
    nonDs: c.nonDs ?? 0,
    deprecated: c.deprecated ?? 0,
    dsComponentUses: c.dsComponentUses ?? 0,
    parseFailed: c.parseFailed ?? 0,
    files: 1,
  };
  const den = totals.token + totals.hardcoded;
  const denAll = den + totals.tailwindDefault;
  return {
    files: [],
    excluded: [],
    ignored: [],
    deleted: [],
    expectedFile,
    totals,
    compliance: den === 0 ? null : Math.round((totals.token / den) * 10_000) / 10_000,
    tokenShareAll: denAll === 0 ? null : Math.round((totals.token / denAll) * 10_000) / 10_000,
  };
}

function run(
  prompt: string,
  condition: Condition,
  c: Counts,
  extra: Partial<RunRecord> = {},
): RunRecord {
  return {
    prompt,
    condition,
    rep: 1,
    status: "ok",
    exitCode: 0,
    durationMs: 1000,
    agentMeta: { costUsd: 0.05, turns: 4, models: ["claude-sonnet-5-5"] },
    harnessPathSeen: false,
    score: score(c),
    ...extra,
  };
}

function aggregateOf(runs: RunRecord[]): Aggregate {
  const sum = (f: (r: RunRecord) => number): number => runs.reduce((a, r) => a + f(r), 0);
  const t = (k: keyof RunScore["totals"]) => sum((r) => r.score.totals[k]);
  const token = t("token");
  const hardcoded = t("hardcoded");
  const tw = t("tailwindDefault");
  const costs = runs.flatMap((r) => (r.agentMeta?.costUsd === undefined ? [] : [r.agentMeta.costUsd]));
  return {
    token,
    knownToken: t("knownToken"),
    hardcoded,
    replaceable: t("replaceable"),
    tailwindDefault: tw,
    dynamic: t("dynamic"),
    runs: runs.length,
    okRuns: runs.filter((r) => r.status === "ok").length,
    failedRuns: runs.filter((r) => r.status === "agent-error" || r.status === "timeout").length,
    missingExpected: runs.filter((r) => !r.score.expectedFile).length,
    harnessPathSeen: runs.filter((r) => r.harnessPathSeen).length,
    nonDs: t("nonDs"),
    deprecated: t("deprecated"),
    dsComponentUses: t("dsComponentUses"),
    parseFailed: t("parseFailed"),
    files: t("files"),
    compliance: token + hardcoded === 0 ? null : Math.round((token / (token + hardcoded)) * 10_000) / 10_000,
    tokenShareAll: token + hardcoded + tw === 0 ? null : Math.round((token / (token + hardcoded + tw)) * 10_000) / 10_000,
    costUsd: costs.length === 0 ? null : costs.reduce((a, b) => a + b, 0),
    turns: null,
  };
}

function build(runs: RunRecord[], over: Partial<BenchResult> = {}): BenchResult {
  return {
    version: 1,
    date: "2026-11-01",
    startedAt: "2026-11-01T01:00:00.000Z",
    repo: "legacy-demo",
    mode: "agent",
    agent: {
      command: "claude -p --output-format stream-json --model sonnet",
      version: "2.1.316 (Claude Code)",
      installTool: "claude-code",
      models: ["claude-sonnet-5-5"],
    },
    dsmith: { version: "0.1.0", commit: "42efa30d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b" },
    base: { tokens: 14, dsComponents: 6, snapshotSha256: "0123456789abcdef0123456789abcdef" },
    prompts: [
      { id: "01-form", file: "src/components/ContactForm.tsx", sha256: "a" },
      { id: "06-badge", file: "src/components/StatusBadge.tsx", sha256: "b" },
    ],
    conditions: ["baseline", "dsmith"],
    repeat: 1,
    timeoutSec: 600,
    runs,
    aggregate: {
      baseline: aggregateOf(runs.filter((r) => r.condition === "baseline")),
      dsmith: aggregateOf(runs.filter((r) => r.condition === "dsmith")),
    },
    ...over,
  };
}

/** 베이스라인 token 1·hardcoded 7·DS 외 3, dsmith token 7·hardcoded 1·DS 외 0 */
function fixture(): BenchResult {
  return build([
    run("01-form", "baseline", { token: 1, hardcoded: 3, tailwindDefault: 2, nonDs: 2 }),
    run("01-form", "dsmith", { token: 3, hardcoded: 1, dsComponentUses: 1 }),
    run("06-badge", "baseline", { token: 0, hardcoded: 4, nonDs: 1 }),
    run("06-badge", "dsmith", { token: 4, knownToken: 3, hardcoded: 0, dsComponentUses: 2 }),
  ]);
}

const EXPECTED = [
  "# 벤치마크 결과 — legacy-demo (2026-11-01)",
  "",
  "| 항목 | 값 |",
  "| --- | --- |",
  "| 모드 | agent |",
  "| 프롬프트 수 N | 2 |",
  "| 조건 | baseline, dsmith |",
  "| 반복 | 1 |",
  "| 에이전트 명령 | `claude -p --output-format stream-json --model sonnet` |",
  "| 에이전트 버전 | 2.1.316 (Claude Code) |",
  "| 관측 모델 | claude-sonnet-5-5 |",
  "| dsmith 버전·커밋 | 0.1.0 · 42efa30 |",
  "| 베이스 토큰 수 | 14 |",
  "| 베이스 DS 컴포넌트 수 | 6 |",
  "| 스냅샷 sha256 | 0123456789ab |",
  "| 실행 수 | 총 4 · 성공 4 · 실패 0 · timeout 0 · missing 0 |",
  "| 총비용(USD) | 0.20 |",
  "| harnessPathSeen 실행 수 | 0 |",
  "",
  "## 요약",
  "",
  "| 지표 | baseline | dsmith |",
  "| --- | --- | --- |",
  "| 토큰 준수율 | 12.5% (1/8) | 87.5% (7/8) |",
  "| 토큰 사용률 | 10.0% (1/10) | 87.5% (7/8) |",
  "| token(known) | 1 (1) | 7 (6) |",
  "| hardcoded(대체 가능) | 7 (7) | 1 (1) |",
  "| Tailwind 기본 스케일 | 2 | 0 |",
  "| dynamic | 0 | 0 |",
  "| DS 외 컴포넌트 | 3 | 0 |",
  "| DS 컴포넌트 사용 | 0 | 3 |",
  "| deprecated | 0 | 0 |",
  "| 파싱 실패 | 0 | 0 |",
  "| 기대 파일 없음 | 0 | 0 |",
  "",
  "## 프롬프트별",
  "",
  "| id | 파일 | baseline 준수율 | baseline token/hardcoded/기본 | baseline DS 외 | dsmith 준수율 | dsmith token/hardcoded/기본 | dsmith DS 외 | 판정 |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  "| 01-form | src/components/ContactForm.tsx | 25.0% | 1/3/2 | 2 | 75.0% | 3/1/0 | 0 | 개선 |",
  "| 06-badge | src/components/StatusBadge.tsx | 0.0% | 0/4/0 | 1 | 100.0% | 4/0/0 | 0 | 개선 |",
  "",
  "개선 2 · 같음 0 · 악화 0 · 비교 불가 0",
  "",
  "## 해석 한계",
  "",
  "- 프롬프트 2개·반복 1회의 단일 측정이며 에이전트 출력은 비결정적이다.",
  "- 유의성 검정을 하지 않았다.",
  "- 준수율 분모에서 Tailwind 기본 스케일 클래스는 뺐다(별도 행).",
  "- 렌더링·타입 검사는 하지 않았다. `tokens.css` 로드·프리셋 연결 여부는 측정 밖이다.",
  "- 채점은 dsmith 자신의 규칙 엔진이고 dsmith 조건의 에이전트는 같은 엔진(`lint_snippet`)을 쓸 수 있다. 같은 기준에 맞추도록 돕는 효과를 잰 것이지 독립 평가가 아니다.",
  "- 산출물은 `benchmarks/results/2026-11-01-legacy-demo/outputs`에 있고 `pnpm bench -- --repo legacy-demo --replay benchmarks/results/2026-11-01-legacy-demo/outputs`로 같은 채점을 다시 낼 수 있다.",
  "",
].join("\n");

describe("renderReport", () => {
  it("고정 결과를 정확한 마크다운으로 만든다", () => {
    expect(renderReport(fixture())).toBe(EXPECTED);
  });

  it("같은 입력이면 바이트가 같다", () => {
    expect(renderReport(fixture())).toBe(renderReport(fixture()));
  });

  it("실행 순서와 무관하게 프롬프트 id 순으로 쓴다", () => {
    const f = fixture();
    const shuffled = build([...f.runs].reverse());
    expect(renderReport(shuffled)).toBe(EXPECTED);
  });

  it("replay 결과의 해석 한계는 합성 산출물이라고 밝힌다", () => {
    const md = renderReport(build(fixture().runs, { mode: "replay", startedAt: null, agent: { command: null, version: null, installTool: null, models: [] } }));
    expect(md).toContain("- 합성 산출물 — 실측 아님. 채점 파이프라인 검증용이며 성능 주장에 쓰지 않는다.");
    expect(md).not.toContain("같은 채점을 다시 낼 수 있다");
    expect(md).toContain("| 에이전트 명령 | — |");
    expect(md).toContain("| 에이전트 버전 | — |");
    expect(md).toContain("| 관측 모델 | — |");
    expect(md).toContain("| 총비용(USD) | 0.20 |");
  });

  it("분모 0이면 준수율 대신 —를 쓰고 판정은 비교 불가", () => {
    const md = renderReport(
      build(
        [run("01-form", "baseline", { tailwindDefault: 3 }), run("01-form", "dsmith", { token: 2 })],
        { prompts: [{ id: "01-form", file: "src/components/ContactForm.tsx", sha256: "a" }] },
      ),
    );
    expect(md).toContain("| 토큰 준수율 | — (0/0) | 100.0% (2/2) |");
    expect(md).toContain("| 토큰 사용률 | 0.0% (0/3) | 100.0% (2/2) |");
    expect(md).toContain("| 01-form | src/components/ContactForm.tsx | — | 0/0/3 | 0 | 100.0% | 2/0/0 | 0 | 비교 불가 |");
    expect(md).toContain("개선 0 · 같음 0 · 악화 0 · 비교 불가 1");
  });

  it("같음·악화를 판정하고 반복은 합산한다", () => {
    const md = renderReport(
      build(
        [
          run("01-form", "baseline", { token: 2, hardcoded: 2 }),
          run("01-form", "dsmith", { token: 1, hardcoded: 1 }),
          run("06-badge", "baseline", { token: 3, hardcoded: 1 }),
          { ...run("06-badge", "baseline", { token: 0, hardcoded: 3 }), rep: 2 },
          run("06-badge", "dsmith", { token: 1, hardcoded: 3 }),
          { ...run("06-badge", "dsmith", { token: 0, hardcoded: 0 }), rep: 2 },
        ],
        { repeat: 2 },
      ),
    );
    expect(md).toContain("| 01-form | src/components/ContactForm.tsx | 50.0% | 2/2/0 | 0 | 50.0% | 1/1/0 | 0 | 같음 |");
    expect(md).toContain("| 06-badge | src/components/StatusBadge.tsx | 42.9% | 3/4/0 | 0 | 25.0% | 1/3/0 | 0 | 악화 |");
    expect(md).toContain("개선 0 · 같음 1 · 악화 1 · 비교 불가 0");
    expect(md).toContain("- 프롬프트 2개·반복 2회의 단일 측정이며");
  });

  it("실패·timeout·missing 실행, 파싱 실패, harnessPathSeen을 표시한다", () => {
    const md = renderReport(
      build([
        run("01-form", "baseline", { token: 1, hardcoded: 1, parseFailed: 1 }),
        run("01-form", "dsmith", { token: 1 }, { status: "agent-error", exitCode: 3, harnessPathSeen: true }),
        run("06-badge", "baseline", {}, { status: "timeout", exitCode: null, agentMeta: null }),
        { ...run("06-badge", "dsmith", {}, { status: "missing", exitCode: null, durationMs: null, agentMeta: null }), score: score({}, false) },
      ]),
    );
    expect(md).toContain("| 실행 수 | 총 4 · 성공 1 · 실패 1 · timeout 1 · missing 1 |");
    expect(md).toContain("| harnessPathSeen 실행 수 | 1 |");
    expect(md).toContain("**경고:** 1개 실행의 에이전트 출력에서 채점 코드 경로(`benchmarks`)가 보였다. 해당 실행은 오염됐을 수 있다.");
    expect(md).toContain("| 파싱 실패 | 1 | 0 |");
    expect(md).toContain("| 기대 파일 없음 | 0 | 1 |");
  });

  it("선택 필드가 없어도 던지지 않는다(조건 하나, 비용·커밋 없음)", () => {
    const f = fixture();
    const noCost = f.runs.map((r) => ({ ...r, agentMeta: null }));
    const only = build(noCost.filter((r) => r.condition === "dsmith"), {
      conditions: ["dsmith"],
      dsmith: { version: "0.1.0", commit: null },
    });
    delete only.aggregate.baseline;
    const md = renderReport(only);
    expect(md).toContain("| 조건 | dsmith |");
    expect(md).toContain("| dsmith 버전·커밋 | 0.1.0 · — |");
    expect(md).toContain("| 총비용(USD) | — |");
    expect(md).toContain("| 토큰 준수율 | — | 87.5% (7/8) |");
    expect(md).toContain("| 01-form | src/components/ContactForm.tsx | — | — | — | 75.0% | 3/1/0 | 0 | 비교 불가 |");
  });

  it("명령의 파이프 문자는 표가 깨지지 않게 이스케이프한다", () => {
    const f = build(fixture().runs, { agent: { command: "sh -c 'a | b'", version: null, installTool: null, models: [] } });
    expect(renderReport(f)).toContain("| 에이전트 명령 | `sh -c 'a \\| b'` |");
  });
});

describe("readmeLine", () => {
  const MD = "benchmarks/results/2026-11-01-legacy-demo.md";

  it("정확한 한 줄을 만든다", () => {
    expect(readmeLine(fixture(), MD)).toBe(
      "벤치마크(프롬프트 2개 × 조건 2, claude -p, 2026-11-01): 토큰 준수율 12.5% → 87.5%, DS 외 컴포넌트 3 → 0 — benchmarks/results/2026-11-01-legacy-demo.md",
    );
  });

  it("compliance가 null이면 —", () => {
    const f = fixture();
    f.aggregate.baseline = { ...f.aggregate.baseline!, compliance: null };
    expect(readmeLine(f, MD)).toContain("토큰 준수율 — → 87.5%,");
  });

  it("replay 결과면 Error", () => {
    expect(() => readmeLine({ ...fixture(), mode: "replay" }, MD)).toThrow("replay 결과로는 README 줄을 만들지 않음");
  });

  it("조건이 하나면 Error", () => {
    const f = fixture();
    delete f.aggregate.baseline;
    expect(() => readmeLine(f, MD)).toThrow(/둘 다 필요/);
  });
});

describe("reportFromFile (CLI)", () => {
  let dir = "";
  afterEach(() => {
    if (dir !== "") rmSync(dir, { recursive: true, force: true });
  });

  it("--in의 .md를 쓰고 README 줄을 돌려준다", () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "dsmith-report-test-"));
    const json = path.join(dir, "2026-11-01-legacy-demo.json");
    writeFileSync(json, `${JSON.stringify(fixture(), null, 2)}\n`);
    const out = reportFromFile(["--", "--in", json]);
    expect(out.mdFile).toBe(path.join(dir, "2026-11-01-legacy-demo.md"));
    expect(readFileSync(out.mdFile, "utf8")).toBe(EXPECTED);
    expect(out.line).toBe(
      "벤치마크(프롬프트 2개 × 조건 2, claude -p, 2026-11-01): 토큰 준수율 12.5% → 87.5%, DS 외 컴포넌트 3 → 0 — benchmarks/results/2026-11-01-legacy-demo.md",
    );
  });

  it("replay 결과는 md만 쓰고 줄은 null", () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "dsmith-report-test-"));
    const json = path.join(dir, "r.json");
    writeFileSync(json, JSON.stringify({ ...fixture(), mode: "replay" }));
    const out = reportFromFile(["--in", json]);
    expect(out.line).toBeNull();
    expect(readFileSync(out.mdFile, "utf8")).toContain("합성 산출물 — 실측 아님");
  });

  it("--in이 없으면 사용법 Error", () => {
    expect(() => reportFromFile([])).toThrow(/사용법/);
  });
});
