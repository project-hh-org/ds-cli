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

/** decisions 파일의 token-cluster 기록을 후보로. optionIds = record.options */
export function tokenClusterCandidates(file: DecisionsFile): DecisionCandidate[] {
  return file.items
    .filter((r) => r.kind === "token-cluster")
    .map((r) => ({ item: r.item, kind: "token-cluster" as const, optionIds: r.options }));
}

/** index에 hardcoded 색으로 남아 있는 hex 집합 */
function hardcodedColorHexes(index: Index): Set<string> {
  const hexes = new Set<string>();
  for (const u of index.styles) {
    if (u.source === "hardcoded" && u.normalized.kind === "color") hexes.add(u.normalized.hex);
  }
  return hexes;
}

/**
 * 후보 + 파일에만 있는 기록(예: token-cluster)을 합쳐 목록을 만든다.
 * 기록이 decided면 status decided·chosen=기록의 chosen. `status`를 주면 그 상태만 낸다.
 * decided인데 chosen이 현재 선택지에 없으면 stale: duplicate·local-definition은 현재 후보의 optionIds에 없을 때,
 * token-cluster는 chosen hex가 index의 hardcoded 색에 더는 없을 때.
 */
export function listDecisions(
  index: Index,
  file: DecisionsFile,
  status?: "pending" | "decided",
): DecisionListItem[] {
  const items: DecisionListItem[] = [];
  const seen = new Set<string>();
  const keyOf = (item: string, kind: DecisionKind): string => JSON.stringify([item, kind]);

  let colorHexes: Set<string> | undefined;
  const isStale = (kind: DecisionKind, chosen: string, currentOptions: string[] | null): boolean => {
    if (kind === "token-cluster") {
      colorHexes ??= hardcodedColorHexes(index);
      return !colorHexes.has(chosen);
    }
    return currentOptions === null || !currentOptions.includes(chosen);
  };

  const push = (
    item: string,
    kind: DecisionKind,
    options: string[],
    currentOptions: string[] | null,
    record?: DecisionsFile["items"][number],
  ): void => {
    const decided = record?.status === "decided" && record.chosen !== undefined;
    const entry: DecisionListItem = { item, kind, options, status: decided ? "decided" : "pending" };
    if (decided && record?.chosen !== undefined) {
      entry.chosen = record.chosen;
      if (isStale(kind, record.chosen, currentOptions)) entry.stale = true;
    }
    items.push(entry);
  };

  for (const c of decisionCandidates(index)) {
    seen.add(keyOf(c.item, c.kind));
    push(c.item, c.kind, c.optionIds, c.optionIds, file.items.find((r) => r.item === c.item && r.kind === c.kind));
  }
  for (const r of file.items) {
    if (seen.has(keyOf(r.item, r.kind))) continue;
    // 후보에서 사라진 duplicate·local-definition 기록은 현재 선택지가 없다
    push(r.item, r.kind, r.options, null, r);
  }
  return status === undefined ? items : items.filter((i) => i.status === status);
}

const SIMILAR_LIMIT = 5;

/**
 * item 이름의 후보 전부(같은 이름이 duplicate와 local-definition 둘 다일 수 있다). `kind`를 주면 그 종류만.
 * `file`을 주면 그 파일의 token-cluster 기록도 후보로 포함한다.
 */
export function candidatesOf(index: Index, item: string, kind?: DecisionKind, file?: DecisionsFile): DecisionCandidate[] {
  const all = file === undefined ? decisionCandidates(index) : [...decisionCandidates(index), ...tokenClusterCandidates(file)];
  return all.filter((c) => c.item === item && (kind === undefined || c.kind === kind));
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
