import { explainDecision, type DecisionCard, type DecisionKind, type ExplainResult } from "@dsmith-dev/core";
import { shrinkToBudget } from "../budget.js";
import type { Workspace } from "../workspace.js";

export interface ExplainDecisionInput {
  item: string;
  /** 같은 이름이 둘 이상의 종류일 때 고르는 종류(duplicate | local-definition | token-cluster) */
  kind?: DecisionKind | undefined;
}

/**
 * core explainDecision 그대로(옵션 상한은 core 기본 20). 결과는 CLI `decide --explain --json`과 같은 값:
 * 카드는 그대로, 실패는 `{ error: "not-found" | "ambiguous-kind", … }`. 실패를 오류 응답으로 바꾸는 것은 server.ts다.
 */
export function explainDecisionTool(ws: Workspace, input: ExplainDecisionInput, opts: { git: boolean }): Promise<ExplainResult> {
  // CLI와 같은 토큰: 토큰 파일·카탈로그의 토큰만(audit 제안 토큰은 매처에 쓰지 않는다)
  const tokens = ws.tokens.tokens.filter((t) => t.source !== "proposal");
  return explainDecision(ws.root, ws.index, input.item, {
    isDsModule: ws.isDsModule,
    decisions: ws.decisions,
    git: opts.git,
    ...(tokens.length > 0 ? { tokens } : {}),
    ...(input.kind === undefined ? {} : { kind: input.kind }),
  });
}

type ByOption = Record<string, unknown>;

/** 카드에 남은 옵션 id만 키로 두도록 옵션별 맵을 정리한다. */
function pruneByOption(card: Record<string, unknown>): void {
  const ids = new Set((card.options as { id: string }[]).map((o) => o.id));
  const prune = (map: unknown): void => {
    if (typeof map !== "object" || map === null) return;
    for (const key of Object.keys(map)) if (!ids.has(key)) delete (map as ByOption)[key];
  };
  for (const d of (card.differences as { byOption?: unknown }[] | undefined) ?? []) prune(d.byOption);
  prune((card.impact as { byOption?: unknown } | undefined)?.byOption);
  prune((card.ruleCheck as { tokenUsageRate?: unknown } | undefined)?.tokenUsageRate);
  prune((card.ruleCheck as { tokenMatchRate?: unknown } | undefined)?.tokenMatchRate);
  prune((card.history as { byOption?: unknown } | undefined)?.byOption);
}

/**
 * 카드를 상한 안으로 줄인다: 옵션 수·안쪽 목록을 줄이되 추천 옵션(`recommendation.optionId`)은 남기고,
 * 줄어든 옵션 목록에 맞춰 옵션별 맵(differences·impact·ruleCheck·history)도 정리한다. 잘린 양은 `omitted`.
 */
export function shrinkCard(card: DecisionCard, budget: number): ReturnType<typeof shrinkToBudget<DecisionCard>> {
  const recommended = card.recommendation.optionId;
  return shrinkToBudget(card, budget, {
    pin: (path, item) => path === "options" && (item as { id?: string }).id === recommended,
    afterCut: pruneByOption,
  });
}
