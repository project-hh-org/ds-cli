import type {
  Expression,
  Node,
  Statement,
  TSType,
  TSTypeElement,
  VariableDeclarator,
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
    if (part.type === "TSUndefinedKeyword" || part.type === "TSNullKeyword") continue;
    if (part.type !== "TSLiteralType" || part.literal.type !== "StringLiteral") return null;
    values.push(part.literal.value);
  }
  return values.length > 0 ? values : null;
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

const FC_TYPE_NAMES = new Set(["FC", "FunctionComponent", "VFC", "VoidFunctionComponent"]);

/** `const X: React.FC<P>`의 P */
function fcTypeArg(d: VariableDeclarator): TSType | undefined {
  if (d.id.type !== "Identifier") return undefined;
  const ann = d.id.typeAnnotation;
  if (!ann || ann.type !== "TSTypeAnnotation" || ann.typeAnnotation.type !== "TSTypeReference") return undefined;
  const ref = ann.typeAnnotation;
  const n = ref.typeName;
  const base =
    n.type === "Identifier"
      ? n.name
      : n.left.type === "Identifier" && n.left.name === "React"
        ? n.right.name
        : null;
  if (base === null || !FC_TYPE_NAMES.has(base)) return undefined;
  return ref.typeParameters?.params[0];
}

function targetOfDeclarator(d: VariableDeclarator): Target | null {
  const inner = d.init ? targetOf(d.init) : null;
  const typeArg = fcTypeArg(d);
  return typeArg ? { ...(inner ?? {}), typeArg } : inner;
}

/** 이름으로 찾는다. 선언이 없으면 undefined, 있으나 컴포넌트로 못 읽으면 null */
function findTarget(body: Statement[], name: string): Target | null | undefined {
  for (const raw of body) {
    const stmt = unwrapExport(raw);
    if (!stmt) continue;
    if (stmt.type === "FunctionDeclaration" && stmt.id?.name === name) return targetOf(stmt);
    if (stmt.type === "VariableDeclaration") {
      for (const d of stmt.declarations) {
        if (d.id.type === "Identifier" && d.id.name === name) return targetOfDeclarator(d);
      }
    }
  }
  return undefined;
}

/** export default 선언: `export default function (p: P)`, `export default Name`, `export default memo(...)` */
function findDefaultTarget(body: Statement[]): Target | null | undefined {
  for (const stmt of body) {
    if (stmt.type !== "ExportDefaultDeclaration") continue;
    const d = stmt.declaration;
    if (d.type === "Identifier") return findTarget(body, d.name);
    if (d.type === "FunctionDeclaration") return targetOf(d);
    if (d.type === "ClassDeclaration" || d.type === "TSDeclareFunction") return null;
    return targetOf(d);
  }
  return undefined;
}

/** 이름 있는 export 중 대문자로 시작하고 컴포넌트로 읽히는 선언이 정확히 하나면 그것 */
function findSoleExportedTarget(body: Statement[]): Target | null {
  const found: Target[] = [];
  for (const stmt of body) {
    if (stmt.type !== "ExportNamedDeclaration" || !stmt.declaration) continue;
    const d = stmt.declaration;
    if (d.type === "FunctionDeclaration" && d.id && /^[A-Z]/.test(d.id.name)) {
      const t = targetOf(d);
      if (t) found.push(t);
    } else if (d.type === "VariableDeclaration") {
      for (const decl of d.declarations) {
        if (decl.id.type === "Identifier" && /^[A-Z]/.test(decl.id.name)) {
          const t = targetOfDeclarator(decl);
          if (t) found.push(t);
        }
      }
    }
  }
  return found.length === 1 ? (found[0] ?? null) : null;
}

/**
 * 파일 최상위의 `name` 컴포넌트 선언에서 첫 매개변수 타입을 읽는다.
 * 같은 파일의 interface·type 별칭만 따라가고(다른 파일·제네릭은 따라가지 않는다) 못 찾거나 파싱할 수 없으면 null.
 * `name`이 선언돼 있지 않으면 export default, 그다음 유일한 대문자 named export를 대신 읽는다.
 */
export function readComponentProps(code: string, file: string, name: string): ComponentProps | null {
  let body: Statement[];
  try {
    body = parseTsx(code, file).program.body;
  } catch {
    return null;
  }
  // 이름이 선언돼 있지 않으면(`import { Badge as StatusBadge }`·다른 이름으로 default import) default export → 유일한 대문자 export 순으로 본다.
  // 선언은 있으나 읽을 수 없는 경우(null)는 대체하지 않는다.
  let target = findTarget(body, name);
  if (target === undefined) target = findDefaultTarget(body);
  if (target === undefined) target = findSoleExportedTarget(body);
  if (!target) return null;
  const typeNode = target.typeArg ?? target.paramType;
  if (!typeNode) return null;
  const resolved = resolveType(code, typeNode, collectLocalTypes(body));
  if (!resolved) return null;
  return { props: resolved.props, inherits: resolved.inherits };
}
