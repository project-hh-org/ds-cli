import { listDecisions, type DecisionListItem } from "@dsmith-dev/core";
import type { Workspace } from "../workspace.js";

export interface ListDecisionsInput {
  status?: "pending" | "decided" | undefined;
}

export interface DecisionSummary extends DecisionListItem {
  /** 전체 선택지 수. `options`는 앞의 MAX_LISTED_OPTIONS개만 싣는다 */
  optionCount: number;
}

export const MAX_LISTED_OPTIONS = 10;

/** core listDecisions 결과. 선택지가 많은 항목은 options를 앞 10개로 줄이고 optionCount로 전체 수를 알린다. */
export function listDecisionsTool(ws: Workspace, input: ListDecisionsInput): DecisionSummary[] {
  return listDecisions(ws.index, ws.decisions, input.status).map((d) => ({
    ...d,
    options: d.options.slice(0, MAX_LISTED_OPTIONS),
    optionCount: d.options.length,
  }));
}
