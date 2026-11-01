import type { TokenSourceKind } from "@dsmith-dev/core";
import { tokenSourceKind, type Workspace } from "./workspace.js";

/** 사용할 수 있는 토큰 이름 전부. source가 섞인 경우는 "token-file"(토큰별 출처는 resolve_token이 알려준다) */
export function tokensList(ws: Workspace): { source: TokenSourceKind; names: string[] } {
  return { source: tokenSourceKind(ws.tokens), names: ws.tokens.tokens.map((t) => t.name) };
}

/** import 출처가 있는 컴포넌트(module "" 제외), 사용 수 순 */
export function componentsList(ws: Workspace): { source: "index"; components: { name: string; module: string }[] } {
  return {
    source: "index",
    components: ws.components.filter((c) => c.module !== "").map((c) => ({ name: c.name, module: c.module })),
  };
}
