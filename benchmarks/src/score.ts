import picomatch from "picomatch";
import {
  eligibleFindings,
  evaluateFile,
  extractComponentUsage,
  extractFileStyles,
  extractorMatchers,
  findingKey,
  isRatedUsage,
  moduleContextOf,
  parseTsx,
  ruleContextOf,
  type ComponentUsage,
  type Finding,
  type GuardSnapshot,
  type StyleUsage,
} from "@dsmith-dev/core";
import type { FileScore, RunScore, UsageCounts } from "./model.js";

/** 하네스·에이전트 도구가 관리하는 파일 — 에이전트 산출물이 아니므로 채점하지 않는다 */
export const IGNORED: readonly string[] = [
  ".claude/**",
  ".dsmith/**",
  ".mcp.json",
  "AGENTS.md",
  "CLAUDE.md",
  ".codex/**",
  ".cursor/**",
  ".gemini/**",
  "node_modules/**",
  ".git/**",
];

export interface FileChange {
  file: string;
  status: "added" | "modified" | "deleted";
  before: string | null;
  after: string | null;
}

export interface ScoreInput {
  /** 베이스 디렉터리(extractFileStyles의 root, prepare를 마친 matchers의 root) */
  root: string;
  snapshot: GuardSnapshot;
  matchers: ReturnType<typeof extractorMatchers>;
  changes: FileChange[];
  expectedFile: string;
}

const SCRIPT_FILE = /\.[cm]?[jt]sx?$/;
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** `${property}|${raw}|${source}` — conformance·guard와 같은 모양 */
export function usageKey(u: StyleUsage): string {
  return `${u.property}|${u.raw}|${u.source}`;
}

/** 소수 4자리 반올림. 분모 0이면 null */
export function ratio(num: number, den: number): number | null {
  return den === 0 ? null : Math.round((num / den) * 10_000) / 10_000;
}

const CSS_VAR = /var\(\s*(--[A-Za-z0-9_-]+)/g;

/**
 * token 사용이 베이스 기준을 실제로 가리키는가: raw 안의 `var(--x)` 이름이 모두 snapshot.tokens의 name이고 1개 이상이거나,
 * var()가 없고 snapshot.preset?.keys의 값(예 "ds-blue-400") 중 하나로 raw가 `-<key>`로 끝남(Tailwind 변형 접두·`!`·`/불투명도` 무시).
 */
export function isKnownTokenRef(u: StyleUsage, snapshot: GuardSnapshot): boolean {
  const names = [...u.raw.matchAll(CSS_VAR)].map((m) => m[1] ?? "");
  if (names.length > 0) {
    const known = new Set(snapshot.tokens.map((t) => t.name));
    return names.every((n) => known.has(n));
  }
  if (u.raw.includes("var(")) return false;
  const keys = snapshot.preset?.keys;
  if (keys === undefined) return false;
  const raw = u.raw.replace(/!$/, "").replace(/\/\d+(\.\d+)?$/, "");
  return Object.values(keys).some((key) => raw.endsWith(`-${key}`));
}

interface Analysis {
  findings: Finding[];
  usages: StyleUsage[];
  components: ComponentUsage[];
}

/** guard ci.ts `findingsOf`와 같은 조합. 던지면 호출자가 처리한다. */
function analyze(code: string, file: string, input: ScoreInput): Analysis {
  const { root, snapshot, matchers } = input;
  const usages = extractFileStyles({ root, file, code }, matchers).styles;
  let components: ComponentUsage[] = [];
  if (SCRIPT_FILE.test(file)) {
    components = extractComponentUsage(file, parseTsx(code, file), snapshot.moduleContext.tsPaths, moduleContextOf(snapshot));
  }
  const findings = eligibleFindings(evaluateFile({ file, usages, components, ...ruleContextOf(snapshot) }));
  return { findings, usages, components };
}

/** after 항목 중 before에 짝이 없는 것(다중집합 차, after 순서 유지). 음수 없음. */
function multisetNew<T>(after: readonly T[], before: readonly T[], key: (x: T) => string): T[] {
  const remaining = new Map<string, number>();
  for (const b of before) remaining.set(key(b), (remaining.get(key(b)) ?? 0) + 1);
  const out: T[] = [];
  for (const a of after) {
    const k = key(a);
    const left = remaining.get(k) ?? 0;
    if (left > 0) remaining.set(k, left - 1);
    else out.push(a);
  }
  return out;
}

const emptyCounts = (): UsageCounts => ({ token: 0, knownToken: 0, hardcoded: 0, replaceable: 0, tailwindDefault: 0, dynamic: 0 });

function scoreFile(change: FileChange & { status: "added" | "modified" }, input: ScoreInput): FileScore {
  const { snapshot } = input;
  const base: FileScore = {
    file: change.file,
    status: change.status,
    parseFailed: false,
    introduced: emptyCounts(),
    nonDs: 0,
    deprecated: 0,
    dsComponentUses: 0,
    nonDsDetails: [],
  };
  let after: Analysis;
  try {
    after = analyze(change.after ?? "", change.file, input);
  } catch {
    return { ...base, parseFailed: true };
  }
  // 이전 내용이 없거나 읽을 수 없으면 "사용 없음"(guard와 같음)
  let before: Analysis = { findings: [], usages: [], components: [] };
  if (change.before !== null) {
    try {
      before = analyze(change.before, change.file, input);
    } catch {
      // 사용 없음
    }
  }

  const introduced = emptyCounts();
  const newFindings = multisetNew(after.findings, before.findings, findingKey);
  const nonDsDetails: FileScore["nonDsDetails"] = [];
  let deprecated = 0;
  for (const f of newFindings) {
    if (f.rule === "no-hardcoded-style") {
      introduced.hardcoded += 1;
      if (f.style?.replacement != null) introduced.replaceable += 1;
    } else if (f.rule === "prefer-ds-component") {
      nonDsDetails.push({ name: f.component?.name ?? "", module: f.component?.module ?? "", preferModule: f.component?.preferModule ?? "" });
    } else deprecated += 1;
  }

  const rated = (u: StyleUsage): boolean => isRatedUsage(u);
  const newRated = multisetNew(after.usages.filter(rated), before.usages.filter(rated), usageKey);
  for (const u of newRated) {
    if (u.source === "token") {
      introduced.token += 1;
      if (isKnownTokenRef(u, snapshot)) introduced.knownToken += 1;
    } else if (u.source === "tailwind-default") introduced.tailwindDefault += 1;
  }
  const dynamic = (u: StyleUsage): boolean => u.source === "dynamic";
  introduced.dynamic = multisetNew(after.usages.filter(dynamic), before.usages.filter(dynamic), usageKey).length;

  const dsModules = new Set(snapshot.ds.modules);
  for (const c of snapshot.ds.components) {
    dsModules.add(c.module);
    for (const m of c.modules ?? []) dsModules.add(m);
  }
  const componentKey = (c: ComponentUsage): string => `${c.name}|${c.module}`;
  const dsComponentUses = multisetNew(after.components, before.components, componentKey).filter((c) => dsModules.has(c.module)).length;

  return { ...base, introduced, nonDs: nonDsDetails.length, deprecated, dsComponentUses, nonDsDetails };
}

/**
 * 에이전트가 바꾼 파일을 채점한다. 순수 함수 — 파일시스템·프로세스 없음, 같은 입력이면 같은 출력.
 * 새로 생긴 사용·finding만 센다(추가 파일은 전부, 수정 파일은 before 대비 다중집합 차).
 */
export function scoreRun(input: ScoreInput): RunScore {
  const { snapshot, matchers } = input;
  const isIgnored = picomatch([...IGNORED], { dot: true });
  const isExcluded = snapshot.exclude.length === 0 ? () => false : picomatch([...snapshot.exclude], { dot: true });

  const files: FileScore[] = [];
  const excluded: string[] = [];
  const ignored: string[] = [];
  const deleted: string[] = [];
  for (const change of [...input.changes].sort((a, b) => byCodeUnit(a.file, b.file))) {
    const { file } = change;
    if (change.status === "deleted") deleted.push(file);
    else if (isIgnored(file)) ignored.push(file);
    else if (isExcluded(file)) excluded.push(file);
    else if (!SCRIPT_FILE.test(file) && !matchers.some((m) => m.matches(file))) ignored.push(file);
    else files.push(scoreFile({ ...change, status: change.status }, input));
  }

  const totals: RunScore["totals"] = { ...emptyCounts(), nonDs: 0, deprecated: 0, dsComponentUses: 0, parseFailed: 0, files: files.length };
  for (const f of files) {
    if (f.parseFailed) {
      totals.parseFailed += 1;
      continue;
    }
    for (const k of Object.keys(f.introduced) as (keyof UsageCounts)[]) totals[k] += f.introduced[k];
    totals.nonDs += f.nonDs;
    totals.deprecated += f.deprecated;
    totals.dsComponentUses += f.dsComponentUses;
  }

  return {
    files,
    excluded,
    ignored,
    deleted,
    expectedFile: input.changes.some((c) => c.file === input.expectedFile && c.status !== "deleted"),
    totals,
    compliance: ratio(totals.token, totals.token + totals.hardcoded),
    tokenShareAll: ratio(totals.token, totals.token + totals.hardcoded + totals.tailwindDefault),
  };
}
