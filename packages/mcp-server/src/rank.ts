import type { Workspace } from "./workspace.js";

/** `decide --choose`로 정한 duplicate 항목의 module. 결정이 없으면 undefined. */
export function decidedModule(ws: Workspace, name: string): string | undefined {
  const record = ws.decisions.items.find((r) => r.item === name && r.kind === "duplicate" && r.status === "decided");
  return record?.chosen;
}

/** 같은 근거로 줄 세울 때의 우선순위: 결정된 module → DS module → (호출한 쪽의) 사용 수. 큰 값이 먼저. */
export function precedence(ws: Workspace, name: string, module: string): { decided: boolean; isDs: boolean } {
  return { decided: decidedModule(ws, name) === module, isDs: ws.isDsModule(module) };
}
