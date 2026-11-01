import { explainDecision, type DecisionKind, type ExplainResult } from "@dsmith-dev/core";
import type { Workspace } from "../workspace.js";

export interface ExplainDecisionInput {
  item: string;
  /** 같은 이름이 duplicate와 local-definition 둘 다일 때 고르는 종류 */
  kind?: DecisionKind | undefined;
}

/**
 * core explainDecision 그대로(옵션 상한은 core 기본 20). 결과는 CLI `decide --explain --json`과 같은 값:
 * 카드는 그대로, 실패는 `{ error: "not-found" | "ambiguous-kind", … }`. 실패를 오류 응답으로 바꾸는 것은 server.ts다.
 */
export function explainDecisionTool(ws: Workspace, input: ExplainDecisionInput, opts: { git: boolean }): Promise<ExplainResult> {
  return explainDecision(ws.root, ws.index, input.item, {
    isDsModule: ws.isDsModule,
    decisions: ws.decisions,
    git: opts.git,
    ...(input.kind === undefined ? {} : { kind: input.kind }),
  });
}
