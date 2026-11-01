import { searchComponents, type ComponentMatch } from "@dsmith-dev/core";
import { precedence, standing } from "../rank.js";
import type { Workspace } from "../workspace.js";

export interface SearchComponentInput {
  intent: string;
  limit?: number | undefined;
  /** 페이지 커서. 페이지 나누기는 server.ts가 한다. */
  cursor?: string | undefined;
}

/** 검색 결과 한 건. `status: "scaffold"` = dsmith init이 만든 골격(구현 전) — 실제 구현보다 항상 뒤에 나온다 */
export type SearchMatch = ComponentMatch & { status?: "scaffold" };

const DEFAULT_LIMIT = 10;

/**
 * 의도 문장으로 컴포넌트를 찾는다. `matches`는 상위 limit(기본 10)개, `matched`는 limit 전의 일치 수.
 * 골격(status scaffold)은 점수와 상관없이 실제 구현 뒤에 둔다. 점수가 같으면 결정된 module → DS module → 사용 수 순이고, 그 기준으로 앞선 항목의 `why`에 밝힌다.
 */
export function searchComponent(ws: Workspace, input: SearchComponentInput): { matches: SearchMatch[]; matched: number } {
  const found = searchComponents(ws.candidates, input.intent);
  const flags = new Map(found.map((m) => [m, precedence(ws, m.name, m.module)] as const));
  const scaffoldOf = (m: ComponentMatch): boolean => flags.get(m)?.scaffold === true;
  const rankOf = (m: ComponentMatch): [number, number] => standing(flags.get(m) ?? { decided: false, isDs: false, inCatalog: false });
  const sorted = found
    .map((m, i) => ({ m, i }))
    .sort((a, b) => {
      const fa = rankOf(a.m);
      const fb = rankOf(b.m);
      return (
        Number(scaffoldOf(a.m)) - Number(scaffoldOf(b.m)) || b.m.score - a.m.score || fb[0] - fa[0] || fb[1] - fa[1] || a.i - b.i
      );
    })
    .map((x) => x.m);

  const all = sorted.map((m): SearchMatch => {
    const f = flags.get(m);
    if (f?.scaffold === true) return { ...m, why: `${m.why}; 골격(구현 전) — 새 UI에 쓰지 말 것`, status: "scaffold" };
    const rivals = sorted.filter((o) => o !== m && o.score === m.score && !scaffoldOf(o));
    const beatsDecided = f?.decided === true && rivals.some((o) => flags.get(o)?.decided !== true);
    const strong = (x: ComponentMatch): boolean => rankOf(x)[1] === 1;
    const beatsPlain = strong(m) && rivals.some((o) => !strong(o) && flags.get(o)?.decided !== true);
    if (beatsDecided) return { ...m, why: `${m.why}; 동점이면 결정된 선택지 우선` };
    if (beatsPlain) return { ...m, why: `${m.why}; 동점이면 ${f?.isDs === true ? "DS 모듈" : "카탈로그 항목"} 우선` };
    return m;
  });
  return { matches: all.slice(0, input.limit ?? DEFAULT_LIMIT), matched: all.length };
}
