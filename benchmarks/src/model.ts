export type Condition = "baseline" | "dsmith";
export const CONDITIONS: readonly Condition[] = ["baseline", "dsmith"];

/** 한 파일(또는 합계)에서 에이전트가 새로 만든 스타일 사용 수 */
export interface UsageCounts {
  /** rated && source "token" (새로 생긴 것) */
  token: number;
  /** token 중 isKnownTokenRef 참 */
  knownToken: number;
  /** no-hardcoded-style finding(eligible) 수 — evaluateFile 기준 */
  hardcoded: number;
  /** 그중 replacement !== null */
  replaceable: number;
  /** rated && source "tailwind-default" */
  tailwindDefault: number;
  /** source "dynamic" */
  dynamic: number;
}

export interface FileScore {
  /** 복사본 root 상대 POSIX */
  file: string;
  status: "added" | "modified";
  /** 추출·파싱이 던짐 → 집계에서 뺀다(파일 수에는 셈) */
  parseFailed: boolean;
  introduced: UsageCounts;
  /** prefer-ds-component finding(새로 생긴 것) */
  nonDs: number;
  /** no-deprecated-component finding(새로 생긴 것) */
  deprecated: number;
  /** 새로 생긴 컴포넌트 사용 중 module이 DS module인 것 */
  dsComponentUses: number;
  nonDsDetails: { name: string; module: string; preferModule: string }[];
}

export interface RunScore {
  /** file 순 */
  files: FileScore[];
  /** snapshot.exclude 매칭(예: design-system/**) — 채점 안 함 */
  excluded: string[];
  /** 스크립트·Extractor 대상 아님, 또는 하네스 관리 파일(IGNORED) */
  ignored: string[];
  deleted: string[];
  /** 프롬프트의 file이 added|modified에 있는가 */
  expectedFile: boolean;
  totals: UsageCounts & { nonDs: number; deprecated: number; dsComponentUses: number; parseFailed: number; files: number };
  /** token / (token + hardcoded), 분모 0이면 null, 소수 4자리 */
  compliance: number | null;
  /** token / (token + hardcoded + tailwindDefault) */
  tokenShareAll: number | null;
}

export interface AgentMeta {
  costUsd?: number;
  turns?: number;
  subtype?: string;
  models?: string[];
  permissionDenials?: number;
  isError?: boolean;
}

export interface RunRecord {
  prompt: string;
  condition: Condition;
  rep: number;
  status: "ok" | "agent-error" | "timeout" | "replay" | "missing";
  exitCode: number | null;
  durationMs: number | null;
  agentMeta: AgentMeta | null;
  harnessPathSeen: boolean;
  score: RunScore;
}

export interface Aggregate extends UsageCounts {
  runs: number;
  okRuns: number;
  failedRuns: number;
  missingExpected: number;
  harnessPathSeen: number;
  nonDs: number;
  deprecated: number;
  dsComponentUses: number;
  parseFailed: number;
  files: number;
  compliance: number | null;
  tokenShareAll: number | null;
  /** agentMeta.costUsd 합(하나도 없으면 null) */
  costUsd: number | null;
  turns: number | null;
}

export interface BenchResult {
  version: 1;
  /** YYYY-MM-DD */
  date: string;
  /** ISO, replay면 null */
  startedAt: string | null;
  repo: "legacy-demo" | "with-ds-app";
  mode: "agent" | "replay";
  agent: { command: string | null; version: string | null; installTool: string | null; models: string[] };
  dsmith: { version: string; commit: string | null };
  base: { tokens: number; dsComponents: number; snapshotSha256: string };
  prompts: { id: string; file: string; sha256: string }[];
  conditions: Condition[];
  repeat: number;
  timeoutSec: number | null;
  runs: RunRecord[];
  aggregate: Partial<Record<Condition, Aggregate>>;
}
