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
  /** JSDoc 본문 첫 문단, 공백 접기, ≤200자(넘치면 "…") */
  description?: string;
  /** @deprecated 뒤 텍스트, 비었으면 "deprecated" */
  deprecated?: string;
  /** @default 뒤 텍스트 */
  default?: string;
}

export interface ComponentDoc {
  description?: string;
  deprecated?: string;
}

export interface ComponentProps {
  props: PropInfo[];
  inherits: string[];
}

interface Members {
  props: PropInfo[];
  inherits: string[];
}

/** 파싱 문맥: 소스 텍스트와 같은 파일 최상위 `const X = { … }`의 키(keyof typeof X용) */
interface Ctx {
  code: string;
  consts: Map<string, string[]>;
  /** 파일 안 모든 주석의 [start, end) — 타입 텍스트에서 지운다 */
  comments: [number, number][];
}

/** 노드 소스 텍스트. 노드 범위 안의 주석(ast.comments 기준 — 문자열 리터럴 속 //는 건드리지 않는다)을 뺀다 */
function textOf(ctx: Ctx, node: Node): string {
  const start = node.start ?? 0;
  const end = node.end ?? 0;
  let out = "";
  let pos = start;
  for (const [cs, ce] of ctx.comments) {
    if (cs < start || ce > end) continue;
    out += ctx.code.slice(pos, cs);
    pos = ce;
  }
  out += ctx.code.slice(pos, end);
  return out.replace(/\s+/g, " ").trim();
}

const DESCRIPTION_MAX = 200;

interface JsDoc {
  description?: string;
  deprecated?: string;
  default?: string;
}

// 노드의 leadingComments 중 마지막 JSDoc 블록(별표 두 개로 시작하는 블록 주석)을 읽는다.
function jsDocOf(node: { leadingComments?: readonly { type: string; value: string }[] | null }): JsDoc | null {
  const comments = node.leadingComments;
  if (!comments || comments.length === 0) return null;
  // 선언 사이에 // 주석이 끼어도 마지막 JSDoc 스타일 블록을 쓴다.
  let last: { type: string; value: string } | undefined;
  for (let i = comments.length - 1; i >= 0; i--) {
    const c = comments[i];
    if (c && c.type === "CommentBlock" && c.value.startsWith("*")) {
      last = c;
      break;
    }
  }
  if (!last) return null;
  const lines = last.value
    .slice(1)
    .split("\n")
    .map((l) => l.replace(/^\s*\*?\s?/, "").replace(/\s+$/, ""));
  const body: string[] = [];
  const tags: { tag: string; text: string[] }[] = [];
  for (const line of lines) {
    const m = /^\s*@(\w+)(?:\s+(.*))?$/.exec(line);
    if (m) {
      tags.push({ tag: m[1] as string, text: [m[2] ?? ""] });
    } else if (tags.length > 0) {
      (tags[tags.length - 1] as { text: string[] }).text.push(line);
    } else {
      body.push(line);
    }
  }
  const out: JsDoc = {};
  // 본문 첫 문단: 첫 비어 있지 않은 줄부터 다음 빈 줄 전까지
  const para: string[] = [];
  for (const line of body) {
    if (line.trim() === "") {
      if (para.length > 0) break;
      continue;
    }
    para.push(line.trim());
  }
  const description = para.join(" ").replace(/\s+/g, " ").trim();
  if (description !== "") {
    out.description = description.length > DESCRIPTION_MAX ? `${description.slice(0, DESCRIPTION_MAX - 1)}…` : description;
  }
  const textOfTag = (name: string): string | undefined => {
    const t = tags.find((x) => x.tag === name);
    return t ? t.text.join(" ").replace(/\s+/g, " ").trim() : undefined;
  };
  const deprecated = textOfTag("deprecated");
  if (deprecated !== undefined) out.deprecated = deprecated === "" ? "deprecated" : deprecated;
  const def = textOfTag("default");
  if (def !== undefined && def !== "") out.default = def;
  return out;
}

function applyDoc(info: PropInfo, doc: JsDoc | null): void {
  if (!doc) return;
  if (doc.description !== undefined) info.description = doc.description;
  if (doc.deprecated !== undefined) info.deprecated = doc.deprecated;
  if (doc.default !== undefined) info.default = doc.default;
}

function memberName(m: TSTypeElement): string | null {
  if (m.type !== "TSPropertySignature" && m.type !== "TSMethodSignature") return null;
  if (m.computed) return null;
  if (m.key.type === "Identifier") return m.key.name;
  if (m.key.type === "StringLiteral") return m.key.value;
  return null;
}

const VALUE_WRAPPERS = new Set(["OverridableStringUnion", "NonNullable"]);

/** 유니온을 펼쳐 문자열 리터럴 값을 모은다. 그 외 부분이 하나라도 있으면 false */
function collectValues(t: TSType, ctx: Ctx, out: string[], depth = 0): boolean {
  if (depth > 6) return false;
  switch (t.type) {
    case "TSUnionType":
      return t.types.every((part) => collectValues(part, ctx, out, depth + 1));
    case "TSParenthesizedType":
      return collectValues(t.typeAnnotation, ctx, out, depth + 1);
    case "TSUndefinedKeyword":
    case "TSNullKeyword":
      return true;
    case "TSLiteralType":
      if (t.literal.type !== "StringLiteral") return false;
      out.push(t.literal.value);
      return true;
    case "TSTypeReference": {
      if (t.typeName.type !== "Identifier" || !VALUE_WRAPPERS.has(t.typeName.name)) return false;
      const first = t.typeParameters?.params[0];
      return first ? collectValues(first, ctx, out, depth + 1) : false;
    }
    case "TSTypeOperator": {
      if (t.operator !== "keyof") return false;
      const q = t.typeAnnotation;
      if (q.type !== "TSTypeQuery" || q.exprName.type !== "Identifier") return false;
      const keys = ctx.consts.get(q.exprName.name);
      if (!keys) return false;
      out.push(...keys);
      return true;
    }
    default:
      return false;
  }
}

function stringLiteralValues(t: TSType, ctx: Ctx): string[] | null {
  const raw: string[] = [];
  if (!collectValues(t, ctx, raw)) return null;
  const values = [...new Set(raw)];
  return values.length > 0 ? values : null;
}

function membersOf(ctx: Ctx, elements: TSTypeElement[]): PropInfo[] {
  const out: PropInfo[] = [];
  for (const m of elements) {
    const name = memberName(m);
    if (name === null) continue;
    if (m.type === "TSPropertySignature") {
      const ann = m.typeAnnotation?.typeAnnotation;
      const info: PropInfo = { name };
      if (ann) {
        info.type = textOf(ctx, ann);
      }
      info.required = m.optional !== true;
      const values = ann ? stringLiteralValues(ann, ctx) : null;
      if (values) info.values = values;
      applyDoc(info, jsDocOf(m));
      out.push(info);
    } else if (m.type === "TSMethodSignature") {
      const info: PropInfo = { name, required: m.optional !== true };
      applyDoc(info, jsDocOf(m));
      out.push(info);
    }
  }
  return out;
}

/** 최상위 `const X = { … }`(as const·satisfies 허용)의 키 */
function collectConsts(body: Statement[]): Map<string, string[]> {
  const consts = new Map<string, string[]>();
  for (const raw of body) {
    const stmt = unwrapExport(raw);
    if (!stmt || stmt.type !== "VariableDeclaration" || stmt.kind !== "const") continue;
    for (const d of stmt.declarations) {
      if (d.id.type !== "Identifier" || !d.init) continue;
      let init: Node = d.init;
      while (init.type === "TSAsExpression" || init.type === "TSSatisfiesExpression" || init.type === "ParenthesizedExpression") {
        init = init.expression;
      }
      if (init.type !== "ObjectExpression") continue;
      // 스프레드·계산된 키·숫자 키가 하나라도 있으면 키를 다 알 수 없다 — 일부만 내놓느니 기록하지 않는다.
      const keys: string[] = [];
      let complete = true;
      for (const p of init.properties) {
        if ((p.type !== "ObjectProperty" && p.type !== "ObjectMethod") || p.computed) {
          complete = false;
          break;
        }
        if (p.key.type === "Identifier") keys.push(p.key.name);
        else if (p.key.type === "StringLiteral") keys.push(p.key.value);
        else {
          complete = false;
          break;
        }
      }
      if (complete) consts.set(d.id.name, keys);
    }
  }
  return consts;
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

function literalMembers(ctx: Ctx, t: TSType): Members | null {
  if (t.type === "TSTypeLiteral") return { props: membersOf(ctx, t.members), inherits: [] };
  if (t.type === "TSParenthesizedType") return literalMembers(ctx, t.typeAnnotation);
  if (t.type === "TSIntersectionType") {
    const result: Members = { props: [], inherits: [] };
    for (const part of t.types) {
      if (part.type === "TSTypeLiteral") result.props.push(...membersOf(ctx, part.members));
      else result.inherits.push(textOf(ctx, part));
    }
    return result;
  }
  return null;
}

/** 매개변수 타입 노드를 같은 파일 안에서만 따라가 멤버로 푼다 */
function resolveType(ctx: Ctx, t: TSType, local: LocalTypes): Members | null {
  const direct = literalMembers(ctx, t);
  if (direct) return direct;
  if (t.type !== "TSTypeReference" || t.typeName.type !== "Identifier") return null;
  // 제네릭 인스턴스(Props<T>)는 따라가지 않는다.
  if (t.typeParameters && t.typeParameters.params.length > 0) return null;
  const name = t.typeName.name;
  const iface = local.interfaces.get(name);
  if (iface) {
    if (iface.typeParameters && iface.typeParameters.params.length > 0) return null;
    return {
      props: membersOf(ctx, iface.body.body),
      inherits: (iface.extends ?? []).map((e) => textOf(ctx, e)),
    };
  }
  const alias = local.aliases.get(name);
  if (alias) {
    if (alias.typeParameters && alias.typeParameters.params.length > 0) return null;
    return literalMembers(ctx, alias.typeAnnotation);
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
  const parsed = parseBody(code, file);
  if (!parsed) return null;
  const { body } = parsed;
  // 이름이 선언돼 있지 않으면(`import { Badge as StatusBadge }`·다른 이름으로 default import) default export → 유일한 대문자 export 순으로 본다.
  // 선언은 있으나 읽을 수 없는 경우(null)는 대체하지 않는다.
  let target = findTarget(body, name);
  if (target === undefined) target = findDefaultTarget(body);
  if (target === undefined) target = findSoleExportedTarget(body);
  if (!target) return null;
  const typeNode = target.typeArg ?? target.paramType;
  if (!typeNode) return null;
  const resolved = resolveType(ctxOf(code, parsed), typeNode, collectLocalTypes(body));
  if (!resolved) return null;
  return { props: resolved.props, inherits: resolved.inherits };
}

interface Parsed {
  body: Statement[];
  comments: [number, number][];
}

function parseBody(code: string, file: string): Parsed | null {
  try {
    const ast = parseTsx(code, file);
    const comments: [number, number][] = (ast.comments ?? []).map((c) => [c.start ?? 0, c.end ?? 0]);
    return { body: ast.program.body, comments };
  } catch {
    return null;
  }
}

function ctxOf(code: string, parsed: Parsed): Ctx {
  return { code, consts: collectConsts(parsed.body), comments: parsed.comments };
}

/**
 * 파일 최상위의 interface/type 별칭 `typeName` 멤버를 읽는다. readComponentProps와 같은 타입 해석 규칙
 * (같은 파일만, 제네릭 선언은 따라가지 않음). 선언이 없거나 읽을 수 없으면 null.
 */
export function readTypeProps(code: string, file: string, typeName: string): ComponentProps | null {
  const parsed = parseBody(code, file);
  if (!parsed) return null;
  const local = collectLocalTypes(parsed.body);
  if (!local.interfaces.has(typeName) && !local.aliases.has(typeName)) return null;
  const ref: TSType = {
    type: "TSTypeReference",
    typeName: { type: "Identifier", name: typeName },
  } as TSType;
  const resolved = resolveType(ctxOf(code, parsed), ref, local);
  return resolved ? { props: resolved.props, inherits: resolved.inherits } : null;
}

/** 최상위 선언 `name`(export로 감싼 것 포함)의 JSDoc. 선언이 없거나 JSDoc이 없으면 null */
export function readComponentDoc(code: string, file: string, name: string): ComponentDoc | null {
  const parsed = parseBody(code, file);
  if (!parsed) return null;
  for (const raw of parsed.body) {
    const stmt = unwrapExport(raw);
    if (!stmt) continue;
    let declares = false;
    if ((stmt.type === "FunctionDeclaration" || stmt.type === "TSDeclareFunction") && stmt.id?.name === name) declares = true;
    else if (stmt.type === "ClassDeclaration" && stmt.id?.name === name) declares = true;
    else if (stmt.type === "VariableDeclaration") {
      declares = stmt.declarations.some((d) => d.id.type === "Identifier" && d.id.name === name);
    }
    if (!declares) continue;
    // export로 감싼 선언의 주석은 감싸는 노드에 붙는다.
    const doc = jsDocOf(raw) ?? jsDocOf(stmt);
    if (!doc) return null;
    const out: ComponentDoc = {};
    if (doc.description !== undefined) out.description = doc.description;
    if (doc.deprecated !== undefined) out.deprecated = doc.deprecated;
    return out.description === undefined && out.deprecated === undefined ? null : out;
  }
  return null;
}
