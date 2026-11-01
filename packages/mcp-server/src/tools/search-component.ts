import { searchComponents, type ComponentMatch } from "@dsmith-dev/core";
import type { Workspace } from "../workspace.js";

export interface SearchComponentInput {
  intent: string;
  limit?: number | undefined;
  /** 페이지 커서. 페이지 나누기는 server.ts가 한다. */
  cursor?: string | undefined;
}

const DEFAULT_LIMIT = 10;

/** 의도 문장으로 컴포넌트를 찾는다. `matches`는 상위 limit(기본 10)개, `matched`는 limit 전의 일치 수. */
export function searchComponent(ws: Workspace, input: SearchComponentInput): { matches: ComponentMatch[]; matched: number } {
  const all = searchComponents(ws.components, input.intent);
  return { matches: all.slice(0, input.limit ?? DEFAULT_LIMIT), matched: all.length };
}
