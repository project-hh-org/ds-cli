import type { Index } from "../index/indexer.js";
import { hardcodedColorHexes, isTokenClusterStale, type DecisionCandidate } from "./candidates.js";
import type { DecisionCard, DecisionOption, DecisionRecord } from "./model.js";

export interface TokenCardInput {
  candidate: DecisionCandidate;
  index: Index;
  record?: DecisionRecord;
}

const TOP_FILES = 5;

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** hex → 그 색을 hardcoded로 쓴 파일별 사용 수 */
function usageByHex(index: Index, hexes: Set<string>): Map<string, Map<string, number>> {
  const byHex = new Map<string, Map<string, number>>();
  for (const u of index.styles) {
    if (u.source !== "hardcoded" || u.normalized.kind !== "color" || !hexes.has(u.normalized.hex)) continue;
    const files = byHex.get(u.normalized.hex) ?? new Map<string, number>();
    files.set(u.file, (files.get(u.file) ?? 0) + 1);
    byHex.set(u.normalized.hex, files);
  }
  return byHex;
}

/** token-cluster 후보(색 클러스터의 원값 hex들) 하나를 결정 카드로 만든다. 파일·git을 읽지 않는 순수 함수. */
export function buildTokenClusterCard(input: TokenCardInput): DecisionCard {
  const { candidate, index, record } = input;
  const usage = usageByHex(index, new Set(candidate.optionIds));

  const built = candidate.optionIds
    .map((hex) => {
      const files = usage.get(hex) ?? new Map<string, number>();
      const usageCount = [...files.values()].reduce((n, c) => n + c, 0);
      const top = [...files.entries()]
        .sort((a, b) => b[1] - a[1] || byCodeUnit(a[0], b[0]))
        .slice(0, TOP_FILES)
        .map(([file]) => file);
      const option: DecisionOption = {
        id: hex,
        label: hex,
        usageCount,
        files: top,
        props: [],
        styleValues: { color: [hex], spacing: [] },
        isDs: false,
      };
      return { option, allFiles: [...files.keys()] };
    })
    .sort((a, b) => b.option.usageCount - a.option.usageCount || byCodeUnit(a.option.id, b.option.id));

  const totalCalls = built.reduce((n, b) => n + b.option.usageCount, 0);
  const impact: DecisionCard["impact"] = { byOption: {} };
  for (const b of built) {
    const others = new Set(built.filter((o) => o !== b).flatMap((o) => o.allFiles));
    impact.byOption[b.option.id] = { callSites: totalCalls - b.option.usageCount, files: others.size };
  }

  const [first, second] = built;
  let recommendation: DecisionCard["recommendation"];
  if (first && (!second || first.option.usageCount > second.option.usageCount)) {
    recommendation = {
      optionId: first.option.id,
      reason: `사용 수 ${first.option.usageCount}회로 가장 많음`,
      confidence: "medium",
      rule: "usage",
    };
  } else {
    recommendation = { optionId: first?.option.id ?? "", reason: "근거가 동률 — 사람이 판단", confidence: "low", rule: "tie" };
  }

  const card: DecisionCard = {
    item: candidate.item,
    kind: "token-cluster",
    styleScope: "file",
    options: built.map((b) => b.option),
    differences: [
      { aspect: "color", byOption: Object.fromEntries(built.map((b) => [b.option.id, [b.option.id]])) },
    ],
    impact,
    ruleCheck: { tokenUsageRate: Object.fromEntries(built.map((b) => [b.option.id, null])) },
    recommendation,
  };
  if (record?.status === "decided" && record.chosen !== undefined) {
    card.decided = { chosen: record.chosen, decidedAt: record.decidedAt ?? "" };
    if (record.note !== undefined) card.decided.note = record.note;
    if (isTokenClusterStale(hardcodedColorHexes(index), record.chosen, candidate.optionIds)) card.decided.stale = true;
  }
  return card;
}
