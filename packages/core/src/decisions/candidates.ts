import type { Index } from "../index/indexer.js";
import { duplicateNames, localDefinitionFiles, localDefinitionsOf, summarizeComponents } from "../component/summary.js";
import type { DecisionKind, DecisionListItem, DecisionsFile } from "./model.js";

export interface DecisionCandidate {
  item: string;
  kind: DecisionKind;
  optionIds: string[];
}

/** 결정이 필요한 항목. duplicateNames 순(사용 수 내림차순) → localDefinitionsOf 순(파일 수 내림차순). 상한 없이 모두 낸다. */
export function decisionCandidates(index: Index): DecisionCandidate[] {
  const summaries = summarizeComponents(index.components);
  const candidates: DecisionCandidate[] = [];
  for (const name of duplicateNames(summaries)) {
    // summaries는 사용 수 내림차순이라 옵션도 그 순서를 따른다. module ""(지역 사용)은 선택지가 아니다.
    const optionIds = summaries.filter((s) => s.name === name && s.module !== "").map((s) => s.module);
    candidates.push({ item: name, kind: "duplicate", optionIds });
  }
  for (const def of localDefinitionsOf(index.components, Number.POSITIVE_INFINITY)) {
    candidates.push({ item: def.name, kind: "local-definition", optionIds: localDefinitionFiles(index.components, def.name) });
  }
  return candidates;
}

/**
 * 후보 + 파일에만 있는 기록(예: 3b token-cluster)을 합쳐 목록을 만든다.
 * 기록이 decided면 status decided·chosen=기록의 chosen. `status`를 주면 그 상태만 낸다.
 */
export function listDecisions(
  index: Index,
  file: DecisionsFile,
  status?: "pending" | "decided",
): DecisionListItem[] {
  const items: DecisionListItem[] = [];
  const seen = new Set<string>();
  const keyOf = (item: string, kind: DecisionKind): string => JSON.stringify([item, kind]);

  const push = (item: string, kind: DecisionKind, options: string[], record?: DecisionsFile["items"][number]): void => {
    const decided = record?.status === "decided" && record.chosen !== undefined;
    const entry: DecisionListItem = { item, kind, options, status: decided ? "decided" : "pending" };
    if (decided && record?.chosen !== undefined) entry.chosen = record.chosen;
    items.push(entry);
  };

  for (const c of decisionCandidates(index)) {
    seen.add(keyOf(c.item, c.kind));
    push(c.item, c.kind, c.optionIds, file.items.find((r) => r.item === c.item && r.kind === c.kind));
  }
  for (const r of file.items) {
    if (seen.has(keyOf(r.item, r.kind))) continue;
    push(r.item, r.kind, r.options, r);
  }
  return status === undefined ? items : items.filter((i) => i.status === status);
}

const SIMILAR_LIMIT = 5;

/** item 이름의 후보 전부(같은 이름이 duplicate와 local-definition 둘 다일 수 있다). `kind`를 주면 그 종류만. */
export function candidatesOf(index: Index, item: string, kind?: DecisionKind): DecisionCandidate[] {
  return decisionCandidates(index).filter((c) => c.item === item && (kind === undefined || c.kind === kind));
}

/** 이름이 item을 포함하거나 item이 이름을 포함하는 후보 이름(대소문자 무시, 중복 제거, 최대 5개). */
export function similarItems(index: Index, item: string): string[] {
  const needle = item.toLowerCase();
  const found = new Set<string>();
  for (const c of decisionCandidates(index)) {
    const lower = c.item.toLowerCase();
    if (lower.includes(needle) || needle.includes(lower)) found.add(c.item);
  }
  return [...found].slice(0, SIMILAR_LIMIT);
}
