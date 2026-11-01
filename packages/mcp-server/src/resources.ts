import type { Workspace } from "./workspace.js";

/**
 * 사용할 수 있는 토큰 이름 전부. 토큰 파일과 audit 제안이 섞이면 source "mixed"이고 `proposals`가 제안 쪽 이름이다.
 */
export function tokensList(ws: Workspace): { source: "token-file" | "proposal" | "mixed"; names: string[]; proposals?: string[] } {
  const out: { source: "token-file" | "proposal" | "mixed"; names: string[]; proposals?: string[] } = {
    source: ws.tokens.source,
    names: ws.tokens.tokens.map((t) => t.name),
  };
  if (ws.tokens.source === "mixed") out.proposals = ws.tokens.tokens.filter((t) => t.source === "proposal").map((t) => t.name);
  return out;
}

/** import 출처가 있는 컴포넌트(module "" 제외), 사용 수 순 */
export function componentsList(ws: Workspace): { source: "index"; components: { name: string; module: string }[] } {
  return {
    source: "index",
    components: ws.components.filter((c) => c.module !== "").map((c) => ({ name: c.name, module: c.module })),
  };
}
