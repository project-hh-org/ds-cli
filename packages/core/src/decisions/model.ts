export type DecisionKind = "duplicate" | "local-definition" | "token-cluster"; // token-cluster는 3b init이 기록
export type Confidence = "high" | "medium" | "low";

export interface GitHistory {
  firstCommit: { sha: string; date: string };
  lastCommit: { sha: string; date: string };
  authorsCount: number;
}

export interface DecisionOption {
  /** duplicate: module, local-definition: 정의 파일 경로 (안정적·사람이 읽는 값) */
  id: string;
  /** duplicate: module, local-definition: file */
  label: string;
  /** duplicate만 */
  module?: string;
  /** 정의 파일(풀렸을 때). local-definition은 항상 */
  file?: string;
  usageCount: number;
  /** 사용 파일 상위 5 (count desc) */
  files: string[];
  /** 사용처 props 합집합 */
  props: string[];
  /** 정의 파일의 hardcoded 색 hex·간격 px, 중복 제거·정렬, 각 ≤10 */
  styleValues: { color: string[]; spacing: number[] };
  isDs: boolean;
}

export type DifferenceAspect = "module" | "props" | "color" | "spacing";

export interface DecisionCard {
  item: string;
  kind: DecisionKind;
  /** usageCount desc → id asc */
  options: DecisionOption[];
  /** 옵션 사이 값이 다른 aspect만. byOption 값은 "그 옵션에만 있는 것" */
  differences: { aspect: DifferenceAspect; byOption: Record<string, string[]> }[];
  /** 그 옵션을 고르면 바꿔야 하는 다른 옵션들의 호출 수·파일 수 */
  impact: { byOption: Record<string, { callSites: number; files: number }> };
  /** 정의 파일 rated 스타일 중 token 비율(소수 4자리), rated 0이면 null. a11yNotes는 3a에서 생략 */
  ruleCheck: { tokenMatchRate: Record<string, number | null>; a11yNotes?: string[] };
  /** git 없거나 정의 파일 없으면 그 옵션 생략, 전부 없으면 필드 생략 */
  history?: { byOption: Record<string, GitHistory> };
  recommendation: {
    optionId: string;
    reason: string;
    confidence: Confidence;
    rule: "ds-module" | "usage" | "token-rate" | "tie";
  };
  decided?: { chosen: string; decidedAt: string; note?: string };
}

export interface DecisionRecord {
  item: string;
  kind: DecisionKind;
  status: "pending" | "decided";
  options: string[];
  chosen?: string;
  note?: string;
  decidedAt?: string;
}

export interface DecisionsFile {
  version: 1;
  items: DecisionRecord[];
}

export interface DecisionListItem {
  item: string;
  kind: DecisionKind;
  options: string[];
  status: "pending" | "decided";
  decided?: string;
}
