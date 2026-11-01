import { searchComponents, type ComponentMatch } from "@dsmith-dev/core";
import type { Workspace } from "../workspace.js";

export interface SearchComponentInput {
  intent: string;
  limit?: number | undefined;
  /** 페이지 커서. 페이지 나누기는 server.ts가 한다. */
  cursor?: string | undefined;
}

const DEFAULT_LIMIT = 10;

/** 의도 문장으로 컴포넌트를 찾는다. 상위 limit(기본 10)개. */
export function searchComponent(ws: Workspace, input: SearchComponentInput): ComponentMatch[] {
  return searchComponents(ws.components, input.intent).slice(0, input.limit ?? DEFAULT_LIMIT);
}
