import type { Index } from "../index/indexer.js";
import { decisionCandidates } from "./candidates.js";
import type { DecisionKind, DecisionRecord, DecisionsFile } from "./model.js";
import { recordDecision } from "./store.js";

export interface SeedLimits {
  duplicate?: number;
  localDefinition?: number;
  tokenCluster?: number;
}

/** item = 색 key(예 "blue-400"), options = 클러스터 구성원 hex */
export interface TokenClusterSeed {
  item: string;
  options: string[];
}

const DEFAULT_LIMIT = 20;

/**
 * 결정이 필요한 항목을 pending 기록으로 시드한다. (item, kind)가 이미 있는 기록(pending·decided)은 건드리지 않는다.
 * duplicate·local-definition은 후보 순서(사용 수·파일 수 순)의 상위 limit개, token-cluster는 options가 2개 이상인 것의 상위 limit개.
 * 순수 함수 — 쓰기는 호출자가 writeDecisions로 한다.
 */
export function seedDecisions(
  file: DecisionsFile,
  index: Index,
  tokenClusters: TokenClusterSeed[],
  limits: SeedLimits = {},
): { file: DecisionsFile; added: DecisionRecord[] } {
  const candidates = decisionCandidates(index);
  const wanted: { item: string; kind: DecisionKind; options: string[] }[] = [];
  const take = (kind: "duplicate" | "local-definition", limit: number): void => {
    for (const c of candidates.filter((x) => x.kind === kind).slice(0, limit)) {
      wanted.push({ item: c.item, kind, options: c.optionIds });
    }
  };
  take("duplicate", limits.duplicate ?? DEFAULT_LIMIT);
  take("local-definition", limits.localDefinition ?? DEFAULT_LIMIT);
  for (const t of tokenClusters.filter((c) => c.options.length >= 2).slice(0, limits.tokenCluster ?? DEFAULT_LIMIT)) {
    wanted.push({ item: t.item, kind: "token-cluster", options: t.options });
  }

  let next = file;
  const added: DecisionRecord[] = [];
  for (const w of wanted) {
    if (next.items.some((r) => r.item === w.item && r.kind === w.kind)) continue;
    const record: DecisionRecord = { item: w.item, kind: w.kind, status: "pending", options: w.options };
    next = recordDecision(next, record);
    added.push(record);
  }
  return { file: next, added };
}
