import type { Index } from "../index/indexer.js";
import { resolveDefinitionFile } from "../component/definition.js";
import { buildDecisionCard } from "./card.js";
import { candidatesOf, similarItems } from "./candidates.js";
import { readGitHistory } from "./git-history.js";
import type { DecisionCard, DecisionKind, DecisionsFile, GitHistory } from "./model.js";

export interface ExplainOptions {
  isDsModule: (module: string) => boolean;
  decisions?: DecisionsFile;
  /** 기본 true. false면 git을 부르지 않는다. */
  git?: boolean;
  /** 같은 이름이 duplicate와 local-definition 둘 다일 때 고르는 종류. 모호한데 없으면 ambiguous-kind. */
  kind?: DecisionKind;
  /** 카드에 싣는 옵션 상한(사용 수 상위 N + 추천 옵션). 기본 20. */
  maxOptions?: number;
}

export type ExplainResult =
  | { card: DecisionCard }
  | { error: "not-found"; candidates: string[] }
  | { error: "ambiguous-kind"; kinds: DecisionKind[] };

export const DEFAULT_MAX_OPTIONS = 20;
const GIT_CONCURRENCY = 6;

/** 동시에 limit개까지만 실행하며 입력 순서대로 결과를 모은다. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const at = next++;
      results[at] = await fn(items[at] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * 결정 카드를 조립한다: 후보 찾기 → 정의 파일 풀기 → (카드에 실릴 옵션만) git 이력 → 순수 카드 빌더.
 * 같은 이름이 duplicate와 local-definition 둘 다이고 `kind`가 없으면 `ambiguous-kind`를 돌려준다.
 */
export async function explainDecision(
  root: string,
  index: Index,
  item: string,
  opts: ExplainOptions,
): Promise<ExplainResult> {
  const matches = candidatesOf(index, item, opts.kind);
  if (matches.length === 0) return { error: "not-found", candidates: similarItems(index, item) };
  const [candidate] = matches;
  if (matches.length > 1 || candidate === undefined) {
    return { error: "ambiguous-kind", kinds: matches.map((c) => c.kind) };
  }

  const definitionFiles: Record<string, string | null> = {};
  for (const id of candidate.optionIds) {
    definitionFiles[id] = candidate.kind === "local-definition" ? id : await resolveDefinitionFile(root, id);
  }

  const record = opts.decisions?.items.find((r) => r.item === candidate.item && r.kind === candidate.kind);
  const base = {
    candidate,
    index,
    isDsModule: opts.isDsModule,
    definitionFiles,
    maxOptions: opts.maxOptions ?? DEFAULT_MAX_OPTIONS,
    ...(record ? { record } : {}),
  };

  let history: Record<string, GitHistory> = {};
  if (opts.git !== false) {
    // 카드에 실릴 옵션이 정해진 뒤에야(추천은 전체 옵션 기준) 그 옵션의 정의 파일만 git으로 읽는다.
    const preview = buildDecisionCard({ ...base, history: {} });
    const files = [
      ...new Set(
        preview.options.map((o) => o.file).filter((f): f is string => f !== undefined),
      ),
    ];
    const found = await mapLimit(files, GIT_CONCURRENCY, async (f) => [f, await readGitHistory(root, f)] as const);
    history = {};
    for (const [file, h] of found) if (h) history[file] = h;
  }
  return { card: buildDecisionCard({ ...base, history }) };
}
