import type { Index } from "../index/indexer.js";
import { resolveDefinitionFile } from "../component/definition.js";
import fs from "node:fs/promises";
import path from "node:path";
import { componentDeclarations } from "../component/declarations.js";
import type { Token } from "../model/token.js";
import { buildDecisionCard } from "./card.js";
import { buildTokenClusterCard } from "./token-card.js";
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
  /** 매칭할 토큰(proposal 제외). 비어 있지 않으면 카드에 tokenMatchRate가 실리고 추천 규칙 3이 그것을 쓴다. */
  tokens?: Token[];
}

export type ExplainResult =
  | { card: DecisionCard }
  | {
      error: "not-found";
      /** 사람·AI가 바로 읽는 다음 행동 안내 */
      message: string;
      /** 이름이 겹치는 항목(최대 5개). kind가 어긋난 경우 항목 자신은 빼고 센다 */
      candidates: string[];
      /** 항목은 있는데 지정한 kind가 아닐 때, 그 항목이 실제로 가진 종류 */
      availableKinds?: DecisionKind[];
    }
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
 * 정의 파일에서 item이 아닌 다른 최상위 컴포넌트 선언의 줄 범위. 읽기·파싱 실패, item 선언을 못 찾음, 다른 선언 없음이면 범위 없음(파일 전체).
 */
async function otherDeclarationRanges(
  root: string,
  file: string,
  item: string,
): Promise<{ startLine: number; endLine: number }[]> {
  let code: string;
  try {
    code = await fs.readFile(path.join(root, file), "utf-8");
  } catch {
    return [];
  }
  const declarations = componentDeclarations(code, file);
  const own = declarations.filter((d) => d.name === item);
  if (own.length === 0) return [];
  // 같은 문장에 선언자가 여럿이면 item 자신의 줄은 뺀다(다른 선언 범위 − item 범위)
  let ranges = declarations.filter((d) => d.name !== item).map((d) => ({ startLine: d.startLine, endLine: d.endLine }));
  for (const o of own) {
    ranges = ranges.flatMap((r) => {
      if (r.endLine < o.startLine || r.startLine > o.endLine) return [r];
      const parts: { startLine: number; endLine: number }[] = [];
      if (r.startLine < o.startLine) parts.push({ startLine: r.startLine, endLine: o.startLine - 1 });
      if (r.endLine > o.endLine) parts.push({ startLine: o.endLine + 1, endLine: r.endLine });
      return parts;
    });
  }
  return ranges;
}

const CHECK_LIST = "list_decisions(또는 decide --list)로 항목을 확인하세요";

function notFound(index: Index, item: string, kind: DecisionKind | undefined, decisions?: DecisionsFile): Extract<ExplainResult, { error: "not-found" }> {
  const available = kind === undefined ? [] : candidatesOf(index, item, undefined, decisions).map((c) => c.kind);
  if (kind !== undefined && available.length > 0) {
    return {
      error: "not-found",
      message: `'${item}'에 ${kind} 종류의 항목은 없음 (있는 종류: ${available.join(", ")}). ${CHECK_LIST}`,
      candidates: similarItems(index, item).filter((name) => name !== item),
      availableKinds: available,
    };
  }
  // 색 토큰의 CSS 변수 이름(`--color-blue-400`)은 결정 항목 키(`blue-400`)가 아니다 — 키를 알려 준다.
  const key = /^(?:--)?color-(.+)$/.exec(item)?.[1];
  if (key !== undefined && decisions?.items.some((r) => r.kind === "token-cluster" && r.item === key) === true) {
    return {
      error: "not-found",
      message: `결정할 항목이 아님: ${item} — 색 토큰의 결정 항목 키는 '${key}'입니다 (CSS 변수 --color-${key}). decide --explain ${key}`,
      candidates: [key],
    };
  }
  return { error: "not-found", message: `결정할 항목이 아님: ${item}. ${CHECK_LIST}`, candidates: similarItems(index, item) };
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
  const matches = candidatesOf(index, item, opts.kind, opts.decisions);
  if (matches.length === 0) return notFound(index, item, opts.kind, opts.decisions);
  const [candidate] = matches;
  if (matches.length > 1 || candidate === undefined) {
    return { error: "ambiguous-kind", kinds: matches.map((c) => c.kind) };
  }

  if (candidate.kind === "token-cluster") {
    const tokenRecord = opts.decisions?.items.find((r) => r.item === candidate.item && r.kind === "token-cluster");
    return { card: buildTokenClusterCard({ candidate, index, ...(tokenRecord ? { record: tokenRecord } : {}) }) };
  }

  const definitionFiles: Record<string, string | null> = {};
  for (const id of candidate.optionIds) {
    definitionFiles[id] = candidate.kind === "local-definition" ? id : await resolveDefinitionFile(root, id);
  }

  const excludeRanges: Record<string, { startLine: number; endLine: number }[]> = {};
  for (const file of new Set(Object.values(definitionFiles))) {
    if (file === null) continue;
    const ranges = await otherDeclarationRanges(root, file, candidate.item);
    if (ranges.length > 0) excludeRanges[file] = ranges;
  }

  const record = opts.decisions?.items.find((r) => r.item === candidate.item && r.kind === candidate.kind);
  const base = {
    excludeRanges,
    ...(opts.tokens && opts.tokens.length > 0 ? { tokens: opts.tokens } : {}),
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
