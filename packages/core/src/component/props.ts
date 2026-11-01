import type {
  Expression,
  Node,
  Statement,
  TSType,
  TSTypeElement,
} from "@babel/types";
import { parseTsx } from "../parse/tsx.js";

export interface PropInfo {
  name: string;
  type?: string;
  required?: boolean;
  values?: string[];
}

export interface ComponentProps {
  props: PropInfo[];
  inherits: string[];
}

interface Members {
  props: PropInfo[];
  inherits: string[];
}

function textOf(code: string, node: Node): string {
  return code.slice(node.start ?? 0, node.end ?? 0).replace(/\s+/g, " ").trim();
}

function memberName(m: TSTypeElement): string | null {
  if (m.type !== "TSPropertySignature" && m.type !== "TSMethodSignature") return null;
  if (m.computed) return null;
  if (m.key.type === "Identifier") return m.key.name;
  if (m.key.type === "StringLiteral") return m.key.value;
  return null;
}

function stringLiteralValues(t: TSType): string[] | null {
  if (t.type !== "TSUnionType") return null;
  const values: string[] = [];
  for (const part of t.types) {
    if (part.type !== "TSLiteralType" || part.literal.type !== "StringLiteral") return null;
    values.push(part.literal.value);
  }
  return values;
}

function membersOf(code: string, elements: TSTypeElement[]): PropInfo[] {
  const out: PropInfo[] = [];
  for (const m of elements) {
    const name = memberName(m);
    if (name === null) continue;
    if (m.type === "TSPropertySignature") {
      const ann = m.typeAnnotation?.typeAnnotation;
      const info: PropInfo = { name };
      if (ann) {
        info.type = textOf(code, ann);
      }
      info.required = m.optional !== true;
      const values = ann ? stringLiteralValues(ann) : null;
      if (values) info.values = values;
      out.push(info);
    } else if (m.type === "TSMethodSignature") {
      out.push({ name, required: m.optional !== true });
    }
  }
  return out;
}

interface LocalTypes {
  interfaces: Map<string, Statement & { type: "TSInterfaceDeclaration" }>;
  aliases: Map<string, Statement & { type: "TSTypeAliasDeclaration" }>;
}

function unwrapExport(stmt: Statement): Statement | null {
  if ((stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration") && stmt.declaration) {
    return stmt.declaration as Statement;
  }
  return stmt;
}

function collectLocalTypes(body: Statement[]): LocalTypes {
  const interfaces: LocalTypes["interfaces"] = new Map();
  const aliases: LocalTypes["aliases"] = new Map();
  for (const raw of body) {
    const stmt = unwrapExport(raw);
    if (!stmt) continue;
    if (stmt.type === "TSInterfaceDeclaration") interfaces.set(stmt.id.name, stmt as never);
    else if (stmt.type === "TSTypeAliasDeclaration") aliases.set(stmt.id.name, stmt as never);
  }
  return { interfaces, aliases };
}

function literalMembers(code: string, t: TSType): Members | null {
  if (t.type === "TSTypeLiteral") return { props: membersOf(code, t.members), inherits: [] };
  if (t.type === "TSParenthesizedType") return literalMembers(code, t.typeAnnotation);
  if (t.type === "TSIntersectionType") {
    const result: Members = { props: [], inherits: [] };
    for (const part of t.types) {
      if (part.type === "TSTypeLiteral") result.props.push(...membersOf(code, part.members));
      else result.inherits.push(textOf(code, part));
    }
    return result;
  }
  return null;
}

/** 매개변수 타입 노드를 같은 파일 안에서만 따라가 멤버로 푼다 */
function resolveType(code: string, t: TSType, local: LocalTypes): Members | null {
  const direct = literalMembers(code, t);
  if (direct) return direct;
  if (t.type !== "TSTypeReference" || t.typeName.type !== "Identifier") return null;
  // 제네릭 인스턴스(Props<T>)는 따라가지 않는다.
  if (t.typeParameters && t.typeParameters.params.length > 0) return null;
  const name = t.typeName.name;
  const iface = local.interfaces.get(name);
  if (iface) {
    if (iface.typeParameters && iface.typeParameters.params.length > 0) return null;
    return {
      props: membersOf(code, iface.body.body),
      inherits: (iface.extends ?? []).map((e) => textOf(code, e)),
    };
  }
  const alias = local.aliases.get(name);
  if (alias) {
    if (alias.typeParameters && alias.typeParameters.params.length > 0) return null;
    return literalMembers(code, alias.typeAnnotation);
  }
  return null;
}

interface Target {
  /** forwardRef<E, P>의 P */
  typeArg?: TSType;
  /** 내부 함수의 첫 매개변수 타입 */
  paramType?: TSType;
}

function paramTypeOf(fn: { params: Node[] }): TSType | undefined {
  const p = fn.params[0];
  if (!p) return undefined;
  const target = p.type === "AssignmentPattern" ? p.left : p;
  if (target.type === "Identifier" || target.type === "ObjectPattern" || target.type === "ArrayPattern" || target.type === "RestElement") {
    const ann = (target as { typeAnnotation?: Node | null }).typeAnnotation;
    if (ann && ann.type === "TSTypeAnnotation") return ann.typeAnnotation;
  }
  return undefined;
}

function calleeName(callee: Node): string | null {
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier") return callee.property.name;
  return null;
}

/** 함수·forwardRef·memo 래퍼를 풀어 props 타입의 출처를 찾는다. 래퍼 중첩은 memo(forwardRef(...))까지 허용한다 */
function targetOf(expr: Expression | Node, depth = 0): Target | null {
  if (depth > 3) return null;
  switch (expr.type) {
    case "ArrowFunctionExpression":
    case "FunctionExpression":
    case "FunctionDeclaration": {
      const paramType = paramTypeOf(expr);
      return paramType ? { paramType } : {};
    }
    case "TSAsExpression":
    case "TSSatisfiesExpression":
    case "ParenthesizedExpression":
      return targetOf(expr.expression, depth + 1);
    case "CallExpression": {
      const callee = calleeName(expr.callee);
      if (callee !== "forwardRef" && callee !== "memo") return null;
      const inner = expr.arguments[0];
      const innerTarget = inner ? targetOf(inner, depth + 1) : null;
      const typeArg = callee === "forwardRef" ? expr.typeParameters?.params[1] : undefined;
      if (typeArg) return { ...(innerTarget ?? {}), typeArg };
      return innerTarget;
    }
    default:
      return null;
  }
}

function findTarget(body: Statement[], name: string): Target | null {
  for (const raw of body) {
    const stmt = unwrapExport(raw);
    if (!stmt) continue;
    if (stmt.type === "FunctionDeclaration" && stmt.id?.name === name) return targetOf(stmt);
    if (stmt.type === "VariableDeclaration") {
      for (const d of stmt.declarations) {
        if (d.id.type === "Identifier" && d.id.name === name && d.init) return targetOf(d.init);
      }
    }
  }
  return null;
}

/**
 * 파일 최상위의 `name` 컴포넌트 선언에서 첫 매개변수 타입을 읽는다.
 * 같은 파일의 interface·type 별칭만 따라가고(다른 파일·제네릭은 따라가지 않는다) 못 찾으면 null.
 */
export function readComponentProps(code: string, file: string, name: string): ComponentProps | null {
  const ast = parseTsx(code, file);
  const body = ast.program.body;
  const target = findTarget(body, name);
  if (!target) return null;
  const typeNode = target.typeArg ?? target.paramType;
  if (!typeNode) return null;
  const resolved = resolveType(code, typeNode, collectLocalTypes(body));
  if (!resolved) return null;
  return { props: resolved.props, inherits: resolved.inherits };
}
