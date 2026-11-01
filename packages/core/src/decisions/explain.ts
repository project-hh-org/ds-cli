import type { Index } from "../index/indexer.js";
import { resolveDefinitionFile } from "../component/definition.js";
import { buildDecisionCard } from "./card.js";
import { decisionCandidates } from "./candidates.js";
import { readGitHistory } from "./git-history.js";
import type { DecisionCard, DecisionsFile, GitHistory } from "./model.js";

export interface ExplainOptions {
  isDsModule: (module: string) => boolean;
  decisions?: DecisionsFile;
  /** 기본 true. false면 git을 부르지 않는다. */
  git?: boolean;
}

export type ExplainResult = { card: DecisionCard } | { error: "not-found"; candidates: string[] };

const SIMILAR_LIMIT = 5;

function similarNames(names: string[], item: string): string[] {
  const needle = item.toLowerCase();
  const found = new Set<string>();
  for (const name of names) {
    const lower = name.toLowerCase();
    if (lower.includes(needle) || needle.includes(lower)) found.add(name);
  }
  return [...found].slice(0, SIMILAR_LIMIT);
}

/**
 * 결정 카드를 조립한다: 후보 찾기 → 정의 파일 풀기 → git 이력(선택) → 순수 카드 빌더.
 * item이 같은 이름의 duplicate와 local-definition 둘 다면 먼저 나오는 duplicate를 쓴다.
 */
export async function explainDecision(
  root: string,
  index: Index,
  item: string,
  opts: ExplainOptions,
): Promise<ExplainResult> {
  const all = decisionCandidates(index);
  const candidate = all.find((c) => c.item === item);
  if (!candidate) return { error: "not-found", candidates: similarNames(all.map((c) => c.item), item) };

  const definitionFiles: Record<string, string | null> = {};
  for (const id of candidate.optionIds) {
    definitionFiles[id] = candidate.kind === "local-definition" ? id : await resolveDefinitionFile(root, id);
  }

  const history: Record<string, GitHistory> = {};
  if (opts.git !== false) {
    const files = [...new Set(Object.values(definitionFiles).filter((f): f is string => f !== null))];
    const found = await Promise.all(files.map(async (f) => [f, await readGitHistory(root, f)] as const));
    for (const [file, h] of found) if (h) history[file] = h;
  }

  const record = opts.decisions?.items.find((r) => r.item === candidate.item && r.kind === candidate.kind);
  const input = { candidate, index, isDsModule: opts.isDsModule, definitionFiles, history };
  return { card: buildDecisionCard(record ? { ...input, record } : input) };
}
