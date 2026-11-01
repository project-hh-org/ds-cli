import type { Node } from "@babel/types";
import { parseTsx } from "../parse/tsx.js";

export interface ComponentDeclaration {
  name: string;
  /** 1-based, 포함 */
  startLine: number;
  endLine: number;
}

const COMPONENT_NAME = /^[A-Z]/;

function rangeOf(node: Node, name: string): ComponentDeclaration | null {
  if (!node.loc) return null;
  return { name, startLine: node.loc.start.line, endLine: node.loc.end.line };
}

/**
 * 최상위 대문자 이름 선언(function/const/let/class, export·export default로 감싼 것 포함)의 줄 범위.
 * export 키워드를 포함한 문장 전체를 범위로 잡는다. 모듈 수준 소문자 상수(`const variants = {…}`)는 포함하지 않는다.
 * 파싱할 수 없으면 빈 배열.
 */
export function componentDeclarations(code: string, file: string): ComponentDeclaration[] {
  let program;
  try {
    program = parseTsx(code, file).program;
  } catch {
    return [];
  }
  const found: ComponentDeclaration[] = [];
  for (const statement of program.body) {
    const decl =
      (statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration") && statement.declaration
        ? statement.declaration
        : statement;
    if ((decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") && decl.id && COMPONENT_NAME.test(decl.id.name)) {
      const r = rangeOf(statement, decl.id.name);
      if (r) found.push(r);
    } else if (decl.type === "VariableDeclaration") {
      const named = decl.declarations.filter((d) => d.id.type === "Identifier" && COMPONENT_NAME.test(d.id.name));
      for (const d of named) {
        // 선언자가 하나면 export를 포함한 문장 전체, 여럿이면 선언자 각자의 범위
        const r = rangeOf(decl.declarations.length === 1 ? statement : d, d.id.type === "Identifier" ? d.id.name : "");
        if (r) found.push(r);
      }
    }
  }
  return found;
}
