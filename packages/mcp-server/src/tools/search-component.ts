import { searchComponents, type ComponentMatch } from "@dsmith-dev/core";
import { precedence } from "../rank.js";
import type { Workspace } from "../workspace.js";

export interface SearchComponentInput {
  intent: string;
  limit?: number | undefined;
  /** 페이지 커서. 페이지 나누기는 server.ts가 한다. */
  cursor?: string | undefined;
}

const DEFAULT_LIMIT = 10;

/**
 * 의도 문장으로 컴포넌트를 찾는다. `matches`는 상위 limit(기본 10)개, `matched`는 limit 전의 일치 수.
 * 점수가 같으면 결정된 module → DS module → 사용 수 순이고, 그 기준으로 앞선 항목의 `why`에 밝힌다.
 */
export function searchComponent(ws: Workspace, input: SearchComponentInput): { matches: ComponentMatch[]; matched: number } {
  const found = searchComponents(ws.components, input.intent);
  const flags = new Map(found.map((m) => [m, precedence(ws, m.name, m.module)] as const));
  const sorted = found
    .map((m, i) => ({ m, i }))
    .sort((a, b) => {
      const fa = flags.get(a.m);
      const fb = flags.get(b.m);
      return b.m.score - a.m.score || Number(fb?.decided) - Number(fa?.decided) || Number(fb?.isDs) - Number(fa?.isDs) || a.i - b.i;
    })
    .map((x) => x.m);

  const all = sorted.map((m): ComponentMatch => {
    const f = flags.get(m);
    const rivals = sorted.filter((o) => o !== m && o.score === m.score);
    const beatsDecided = f?.decided === true && rivals.some((o) => flags.get(o)?.decided !== true);
    const beatsDs = f?.isDs === true && rivals.some((o) => flags.get(o)?.isDs !== true && flags.get(o)?.decided !== true);
    if (beatsDecided) return { ...m, why: `${m.why}; 동점이면 결정된 선택지 우선` };
    if (beatsDs) return { ...m, why: `${m.why}; 동점이면 DS 모듈 우선` };
    return m;
  });
  return { matches: all.slice(0, input.limit ?? DEFAULT_LIMIT), matched: all.length };
}
