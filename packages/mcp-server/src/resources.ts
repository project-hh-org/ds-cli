import type { Workspace } from "./workspace.js";

type TokensListSource = "token-file" | "proposal" | "mixed" | "catalog";

/**
 * 사용할 수 있는 토큰 이름 전부. 토큰 파일·카탈로그와 audit 제안이 섞이면 source "mixed"이고 `proposals`가 제안 쪽 이름이다.
 */
export function tokensList(ws: Workspace): { source: TokensListSource; names: string[]; proposals?: string[] } {
  const out: { source: TokensListSource; names: string[]; proposals?: string[] } = {
    source: ws.tokens.source,
    names: ws.tokens.tokens.map((t) => t.name),
  };
  if (ws.tokens.source === "mixed") out.proposals = ws.tokens.tokens.filter((t) => t.source === "proposal").map((t) => t.name);
  return out;
}

/** 카탈로그가 있으면 카탈로그 항목(이름·module)만, 없으면 import 출처가 있는 컴포넌트(module "" 제외)를 사용 수 순으로 */
export function componentsList(ws: Workspace): { source: "index" | "catalog"; components: { name: string; module: string }[] } {
  if (ws.catalog !== null) {
    return { source: "catalog", components: ws.catalog.components.map((c) => ({ name: c.name, module: c.module })) };
  }
  return {
    source: "index",
    components: ws.components.filter((c) => c.module !== "").map((c) => ({ name: c.name, module: c.module })),
  };
}
