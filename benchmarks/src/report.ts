import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { CONDITIONS } from "./model.js";
import type { Aggregate, BenchResult, Condition, RunRecord } from "./model.js";

const DASH = "—";
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** 0..1 → "12.5%". null이면 "—" */
function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? DASH : `${(value * 100).toFixed(1)}%`;
}

/** 비율 + 분자/분모. 분모 0이면 "— (0/0)" */
function ratioCell(num: number, den: number): string {
  return den === 0 ? `${DASH} (${num}/${den})` : `${pct(num / den)} (${num}/${den})`;
}

function esc(text: string): string {
  return text.replace(/\|/g, "\\|");
}

function table(header: string[], rows: string[][]): string[] {
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ];
}

function summaryRows(agg: Partial<Record<Condition, Aggregate>>): string[][] {
  const cell = (c: Condition, f: (a: Aggregate) => string): string => {
    const a = agg[c];
    return a === undefined ? DASH : f(a);
  };
  const row = (label: string, f: (a: Aggregate) => string): string[] => [
    label,
    cell("baseline", f),
    cell("dsmith", f),
  ];
  return [
    row("토큰 준수율", (a) => ratioCell(a.token, a.token + a.hardcoded)),
    row("토큰 사용률", (a) => ratioCell(a.token, a.token + a.hardcoded + a.tailwindDefault)),
    row("token(known)", (a) => `${a.token} (${a.knownToken})`),
    row("hardcoded(대체 가능)", (a) => `${a.hardcoded} (${a.replaceable})`),
    row("Tailwind 기본 스케일", (a) => String(a.tailwindDefault)),
    row("dynamic", (a) => String(a.dynamic)),
    row("DS 외 컴포넌트", (a) => String(a.nonDs)),
    row("DS 컴포넌트 사용", (a) => String(a.dsComponentUses)),
    row("deprecated", (a) => String(a.deprecated)),
    row("파싱 실패", (a) => String(a.parseFailed)),
    row("기대 파일 없음", (a) => String(a.missingExpected)),
  ];
}

interface Sums {
  token: number;
  hardcoded: number;
  tailwindDefault: number;
  nonDs: number;
}

function sumRuns(runs: RunRecord[]): Sums | null {
  if (runs.length === 0) return null;
  const s: Sums = { token: 0, hardcoded: 0, tailwindDefault: 0, nonDs: 0 };
  for (const r of runs) {
    s.token += r.score.totals.token;
    s.hardcoded += r.score.totals.hardcoded;
    s.tailwindDefault += r.score.totals.tailwindDefault;
    s.nonDs += r.score.totals.nonDs;
  }
  return s;
}

function complianceOf(s: Sums | null): number | null {
  if (s === null || s.token + s.hardcoded === 0) return null;
  return s.token / (s.token + s.hardcoded);
}

type Verdict = "개선" | "같음" | "악화" | "비교 불가";

function verdictOf(base: Sums | null, ds: Sums | null): Verdict {
  const b = complianceOf(base);
  const d = complianceOf(ds);
  if (b === null || d === null) return "비교 불가";
  // 소수 4자리로 맞춰 비교한다(집계 값과 같은 정밀도)
  const rb = Math.round(b * 10_000);
  const rd = Math.round(d * 10_000);
  return rd > rb ? "개선" : rd < rb ? "악화" : "같음";
}

function condCells(s: Sums | null): string[] {
  if (s === null) return [DASH, DASH, DASH];
  return [pct(complianceOf(s)), `${s.token}/${s.hardcoded}/${s.tailwindDefault}`, String(s.nonDs)];
}

function runCountsLine(runs: RunRecord[]): string {
  const count = (status: RunRecord["status"]): number => runs.filter((r) => r.status === status).length;
  let line = `총 ${runs.length} · 성공 ${count("ok")} · 실패 ${count("agent-error")} · timeout ${count("timeout")} · missing ${count("missing")}`;
  const replay = count("replay");
  if (replay > 0) line += ` · 재생 ${replay}`;
  return line;
}

function totalCost(result: BenchResult): string {
  let sum: number | null = null;
  for (const c of CONDITIONS) {
    const cost = result.aggregate[c]?.costUsd;
    if (cost !== null && cost !== undefined) sum = (sum ?? 0) + cost;
  }
  return sum === null ? DASH : sum.toFixed(2);
}

/** 결정적 마크다운. 숫자는 result 값만 */
export function renderReport(result: BenchResult): string {
  const lines: string[] = [];
  const n = result.prompts.length;
  const isReplay = result.mode === "replay";
  const seen = result.runs.filter((r) => r.harnessPathSeen).length;
  const commit = result.dsmith.commit === null ? DASH : result.dsmith.commit.slice(0, 7);

  lines.push(`# 벤치마크 결과 — ${result.repo} (${result.date})`, "");
  lines.push(
    ...table(
      ["항목", "값"],
      [
        ["모드", result.mode],
        ["프롬프트 수 N", String(n)],
        ["조건", result.conditions.join(", ")],
        ["반복", String(result.repeat)],
        ["에이전트 명령", result.agent.command === null ? DASH : `\`${esc(result.agent.command)}\``],
        ["에이전트 버전", result.agent.version ?? DASH],
        ["관측 모델", result.agent.models.length === 0 ? DASH : result.agent.models.join(", ")],
        ["dsmith 버전·커밋", `${result.dsmith.version} · ${commit}`],
        ["베이스 토큰 수", String(result.base.tokens)],
        ["베이스 DS 컴포넌트 수", String(result.base.dsComponents)],
        ["스냅샷 sha256", result.base.snapshotSha256.slice(0, 12)],
        ["실행 수", runCountsLine(result.runs)],
        ["총비용(USD)", totalCost(result)],
        ["harnessPathSeen 실행 수", String(seen)],
      ],
    ),
    "",
  );
  if (seen > 0) {
    lines.push(
      `**경고:** ${seen}개 실행의 에이전트 출력에서 채점 코드 경로(\`benchmarks\`)가 보였다. 해당 실행은 오염됐을 수 있다.`,
      "",
    );
  }

  lines.push("## 요약", "", ...table(["지표", "baseline", "dsmith"], summaryRows(result.aggregate)), "");

  const ids = [...new Set([...result.prompts.map((p) => p.id), ...result.runs.map((r) => r.prompt)])].sort(byCodeUnit);
  const fileOf = new Map(result.prompts.map((p) => [p.id, p.file]));
  const tally: Record<Verdict, number> = { 개선: 0, 같음: 0, 악화: 0, "비교 불가": 0 };
  const promptRows: string[][] = [];
  for (const id of ids) {
    const base = sumRuns(result.runs.filter((r) => r.prompt === id && r.condition === "baseline"));
    const ds = sumRuns(result.runs.filter((r) => r.prompt === id && r.condition === "dsmith"));
    const verdict = verdictOf(base, ds);
    tally[verdict] += 1;
    promptRows.push([id, fileOf.get(id) ?? DASH, ...condCells(base), ...condCells(ds), verdict]);
  }
  lines.push(
    "## 프롬프트별",
    "",
    ...table(
      [
        "id",
        "파일",
        "baseline 준수율",
        "baseline token/hardcoded/기본",
        "baseline DS 외",
        "dsmith 준수율",
        "dsmith token/hardcoded/기본",
        "dsmith DS 외",
        "판정",
      ],
      promptRows,
    ),
    "",
    `개선 ${tally["개선"]} · 같음 ${tally["같음"]} · 악화 ${tally["악화"]} · 비교 불가 ${tally["비교 불가"]}`,
    "",
  );

  const recordPath = `benchmarks/results/${result.date}-${result.repo}/outputs`;
  lines.push(
    "## 해석 한계",
    "",
    `- 프롬프트 ${n}개·반복 ${result.repeat}회의 단일 측정이며 에이전트 출력은 비결정적이다.`,
    "- 유의성 검정을 하지 않았다.",
    "- 준수율 분모에서 Tailwind 기본 스케일 클래스는 뺐다(별도 행).",
    "- 렌더링·타입 검사는 하지 않았다. `tokens.css` 로드·프리셋 연결 여부는 측정 밖이다.",
    "- 채점은 dsmith 자신의 규칙 엔진이고 dsmith 조건의 에이전트는 같은 엔진(`lint_snippet`)을 쓸 수 있다. 같은 기준에 맞추도록 돕는 효과를 잰 것이지 독립 평가가 아니다.",
    isReplay
      ? "- 합성 산출물 — 실측 아님. 채점 파이프라인 검증용이며 성능 주장에 쓰지 않는다."
      : `- 산출물은 \`${recordPath}\`에 있고 \`pnpm bench -- --repo ${result.repo} --replay ${recordPath}\`로 같은 채점을 다시 낼 수 있다.`,
    "",
  );
  return lines.join("\n");
}

/**
 * README 상단 한 줄. 한 줄, 끝 마침표 없음.
 * replay 결과이거나 조건이 하나뿐이면 Error.
 */
export function readmeLine(result: BenchResult, mdPath: string): string {
  if (result.mode === "replay") throw new Error("replay 결과로는 README 줄을 만들지 않음");
  const base = result.aggregate.baseline;
  const ds = result.aggregate.dsmith;
  if (base === undefined || ds === undefined) throw new Error("README 줄에는 baseline과 dsmith 조건이 둘 다 필요함");
  if (result.agent.command === null) throw new Error("에이전트 명령이 없는 결과로는 README 줄을 만들지 않음");
  const label = result.agent.command.trim().split(/\s+/).slice(0, 2).join(" ");
  return `벤치마크(프롬프트 ${result.prompts.length}개 × 조건 2, ${label}, ${result.date}): 토큰 준수율 ${pct(base.compliance)} → ${pct(ds.compliance)}, DS 외 컴포넌트 ${base.nonDs} → ${ds.nonDs} — ${mdPath}`;
}

const USAGE = "사용법: bench:report -- --in <결과.json> [--out <보고서.md>]";

/** 결과 JSON을 읽어 같은 이름의 .md를 쓰고 README 줄을 돌려준다 */
export function reportFromFile(argv: string[]): { mdFile: string; line: string | null } {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const { values } = parseArgs({
    args,
    options: { in: { type: "string" }, out: { type: "string" } },
    strict: true,
  });
  if (values.in === undefined) throw new Error(USAGE);
  const result = JSON.parse(readFileSync(values.in, "utf8")) as BenchResult;
  if (result.version !== 1) throw new Error(`지원하지 않는 결과 형식: version ${String(result.version)}`);
  const mdFile = values.out ?? values.in.replace(/\.json$/, "") + ".md";
  mkdirSync(path.dirname(path.resolve(mdFile)), { recursive: true });
  writeFileSync(mdFile, renderReport(result));
  const mdPath = `benchmarks/results/${path.basename(mdFile)}`;
  let line: string | null = null;
  try {
    line = readmeLine(result, mdPath);
  } catch {
    line = null;
  }
  return { mdFile, line };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { mdFile, line } = reportFromFile(process.argv.slice(2));
    process.stderr.write(`보고서: ${mdFile}\n`);
    if (line === null) process.stderr.write("README 줄: 만들지 않음(replay 결과이거나 조건이 하나뿐임)\n");
    else process.stdout.write(`${line}\n`);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(2);
  }
}
