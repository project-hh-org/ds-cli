// 선언 파일의 컴포넌트 선언에서 props를 읽는 규칙(부록 B.4의 MUI 배치 기준).
// 같은 파일의 interface·type 별칭만 따라간다. 제네릭 선언은 타입 매개변수 `<…>`를 지운 사본으로 읽고(인자는 무시),
// 유니온·조건부 타입은 모든 가지의 props를 병합하며, interface의 `extends`가 같은 파일 선언이면 그 멤버를 펼친다.
import type { Node, Statement, TSType, TSTypeParameterDeclaration } from "@babel/types";
import { readTypeProps, type ComponentProps, type PropInfo } from "@dsmith-dev/core";

export interface DtsSource {
  code: string;
  /** 최상위 interface·type 별칭의 타입 매개변수를 공백으로 지운 사본(오프셋 보존) */
  plain: string;
  file: string;
  body: Statement[];
}

const MAX_DEPTH = 6;

function unwrapExport(raw: Statement): Statement {
  return (raw.type === "ExportNamedDeclaration" || raw.type === "ExportDefaultDeclaration") && raw.declaration
    ? (raw.declaration as Statement)
    : raw;
}

/** 최상위 interface·type 별칭의 `<…>`를 지운 코드 */
export function stripTypeParameters(code: string, body: Statement[]): string {
  const ranges: [number, number][] = [];
  for (const raw of body) {
    const s = unwrapExport(raw);
    if ((s.type === "TSInterfaceDeclaration" || s.type === "TSTypeAliasDeclaration") && s.typeParameters) {
      const { start, end } = s.typeParameters;
      if (start != null && end != null) ranges.push([start, end]);
    }
  }
  if (ranges.length === 0) return code;
  let out = code;
  for (const [start, end] of ranges) {
    out = out.slice(0, start) + out.slice(start, end).replace(/[^\n]/g, " ") + out.slice(end);
  }
  return out;
}

function textOf(code: string, node: Node): string {
  return code.slice(node.start ?? 0, node.end ?? 0).replace(/\s+/g, " ").trim();
}

function localDecls(body: Statement[]): Map<string, Statement> {
  const out = new Map<string, Statement>();
  for (const raw of body) {
    const s = unwrapExport(raw);
    if (s.type === "TSInterfaceDeclaration" || s.type === "TSTypeAliasDeclaration") out.set(s.id.name, s);
  }
  return out;
}

function mergeInto(into: ComponentProps, from: ComponentProps): void {
  for (const p of from.props) {
    const prior = into.props.find((x) => x.name === p.name);
    if (!prior) into.props.push({ ...p });
    else if (p.values) prior.values = [...new Set([...(prior.values ?? []), ...p.values])];
  }
  for (const i of from.inherits) if (!into.inherits.includes(i)) into.inherits.push(i);
}

function unparen(t: TSType): TSType {
  let n = t;
  while (n.type === "TSParenthesizedType") n = n.typeAnnotation;
  return n;
}

/** 타입 텍스트를 속성 하나의 타입으로 감싸 문자열 리터럴 값을 읽는다 */
function valuesOfTypeText(text: string): string[] | undefined {
  return readTypeProps(`interface __V { v: ${text}; }\n`, "__v.d.ts", "__V")?.props[0]?.values;
}

/** `<Variant extends TextFieldVariants>` → { Variant: ["outlined","standard","filled"] } */
function typeParamValues(src: DtsSource, tps: TSTypeParameterDeclaration | null | undefined): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const decls = localDecls(src.body);
  for (const tp of tps?.params ?? []) {
    const c = tp.constraint;
    if (!c) continue;
    let text = textOf(src.code, c);
    const u = unparen(c);
    if (u.type === "TSTypeReference" && u.typeName.type === "Identifier") {
      const alias = decls.get(u.typeName.name);
      if (alias?.type === "TSTypeAliasDeclaration") text = textOf(src.code, alias.typeAnnotation);
    }
    const values = valuesOfTypeText(text);
    if (values) out.set(tp.name, values);
  }
  return out;
}

function applyTypeParamValues(res: ComponentProps, map: Map<string, string[]>): void {
  if (map.size === 0) return;
  for (const p of res.props) {
    if (p.values || p.type === undefined) continue;
    for (const [name, values] of map) {
      if (new RegExp(`^${name}(\\s*\\|\\s*undefined)?$`).test(p.type)) p.values = [...values];
    }
  }
}

class Reader {
  constructor(readonly src: DtsSource) {
    this.decls = localDecls(src.body);
  }
  private decls: Map<string, Statement>;

  /** 이름 있는 interface/별칭의 props. 읽을 수 없으면 null */
  decl(name: string, depth = 0, seen: string[] = []): ComponentProps | null {
    const decl = this.decls.get(name);
    if (!decl || depth > MAX_DEPTH || seen.includes(name)) return null;
    const trail = [...seen, name];
    if (decl.type === "TSTypeAliasDeclaration") {
      const ann = unparen(decl.typeAnnotation);
      if (ann.type === "TSUnionType" || ann.type === "TSConditionalType" || ann.type === "TSIntersectionType" || ann.type === "TSTypeReference") {
        return this.node(ann, depth + 1, trail);
      }
    }
    const read = readTypeProps(this.src.plain, this.src.file, name);
    if (!read) return null;
    const out: ComponentProps = { props: read.props.map((p) => ({ ...p })), inherits: [] };
    for (const h of read.inherits) {
      const m = /^([A-Za-z_$][\w$]*)(?:<[\s\S]*>)?$/.exec(h);
      const sub = m && this.decls.has(m[1] as string) ? this.decl(m[1] as string, depth + 1, trail) : null;
      if (sub) mergeInto(out, sub);
      else if (!out.inherits.includes(h)) out.inherits.push(h);
    }
    return out;
  }

  node(t: TSType, depth = 0, seen: string[] = []): ComponentProps {
    const out: ComponentProps = { props: [], inherits: [] };
    if (depth > MAX_DEPTH) return out;
    switch (t.type) {
      case "TSParenthesizedType":
        return this.node(t.typeAnnotation, depth + 1, seen);
      case "TSUnionType":
        for (const part of t.types) mergeInto(out, this.node(part, depth + 1, seen));
        return out;
      case "TSIntersectionType":
        for (const part of t.types) mergeInto(out, this.node(part, depth + 1, seen));
        return out;
      case "TSConditionalType":
        mergeInto(out, this.node(t.trueType, depth + 1, seen));
        mergeInto(out, this.node(t.falseType, depth + 1, seen));
        return out;
      case "TSTypeLiteral": {
        const read = readTypeProps(`type __T = ${this.src.code.slice(t.start ?? 0, t.end ?? 0)};\n`, "__t.d.ts", "__T");
        if (read) mergeInto(out, read);
        return out;
      }
      case "TSTypeReference": {
        if (t.typeName.type === "Identifier") {
          const sub = this.decls.has(t.typeName.name) ? this.decl(t.typeName.name, depth + 1, seen) : null;
          if (sub) return sub;
        }
        out.inherits.push(textOf(this.src.code, t));
        return out;
      }
      default:
        return out;
    }
  }
}

const COMPONENT_TYPE = /^(FC|FunctionComponent|VFC|VoidFunctionComponent|ComponentType|ComponentClass|JSXElementConstructor|ExoticComponent|NamedExoticComponent|ForwardRefExoticComponent|MemoExoticComponent)$/;

/** `React.FC`의 FC, `Foo`의 Foo */
function refName(t: TSType & { type: "TSTypeReference" }): string {
  const n = t.typeName;
  return n.type === "Identifier" ? n.name : n.right.name;
}

const nonEmpty = (p: ComponentProps | null): p is ComponentProps => p !== null && p.props.length > 0;

function functionTypeIn(t: TSType, depth = 0): (TSType & { type: "TSFunctionType" }) | null {
  if (depth > 4) return null;
  if (t.type === "TSFunctionType") return t as never;
  if (t.type === "TSParenthesizedType") return functionTypeIn(t.typeAnnotation, depth + 1);
  if (t.type === "TSIntersectionType") {
    for (const part of t.types) {
      const f = functionTypeIn(part, depth + 1);
      if (f) return f;
    }
  }
  return null;
}

function paramType(fn: { params?: Node[]; parameters?: Node[] }): TSType | null {
  const p = (fn.params ?? fn.parameters ?? [])[0];
  if (!p) return null;
  const target = p.type === "AssignmentPattern" ? p.left : p;
  const ann = (target as { typeAnnotation?: Node | null }).typeAnnotation;
  return ann && ann.type === "TSTypeAnnotation" ? ann.typeAnnotation : null;
}

/** props 매개변수 타입에서 읽고, 적거나 `XProps`를 참조하면 XOwnProps → BaseXProps → XProps를 병합한다 */
function fromParam(r: Reader, local: string, t: TSType, tps: TSTypeParameterDeclaration | null | undefined): ComponentProps {
  const res = r.node(t);
  applyTypeParamValues(res, typeParamValues(r.src, tps));
  if (res.props.length < 3 || new RegExp(`\\b${local}Props\\b`).test(textOf(r.src.code, t))) {
    for (const cand of [`${local}OwnProps`, `Base${local}Props`, `${local}Props`]) {
      const read = r.decl(cand);
      if (nonEmpty(read)) mergeInto(res, read);
    }
  }
  return res;
}

/** `${X}TypeMap`(alias 또는 interface)의 `props` 멤버 */
function propsFromTypeMap(r: Reader, name: string): ComponentProps | null {
  const { src } = r;
  let propsType: TSType | null = null;
  const visit = (n: Node | null | undefined, depth = 0): void => {
    if (!n || propsType || depth > 6) return;
    if (n.type === "TSTypeLiteral") {
      for (const m of n.members) {
        if (m.type === "TSPropertySignature" && m.key.type === "Identifier" && m.key.name === "props" && m.typeAnnotation) {
          propsType = m.typeAnnotation.typeAnnotation;
          return;
        }
      }
    } else if (n.type === "TSTypeReference") {
      for (const p of n.typeParameters?.params ?? []) visit(p, depth + 1);
    } else if (n.type === "TSIntersectionType") {
      for (const p of n.types) visit(p, depth + 1);
    } else if (n.type === "TSParenthesizedType") {
      visit(n.typeAnnotation, depth + 1);
    }
  };
  for (const raw of src.body) {
    const s = unwrapExport(raw);
    if (s.type === "TSTypeAliasDeclaration" && s.id.name === `${name}TypeMap`) visit(s.typeAnnotation);
    else if (s.type === "TSInterfaceDeclaration" && s.id.name === `${name}TypeMap`) visit({ type: "TSTypeLiteral", members: s.body.body } as never);
  }
  if (!propsType) return null;
  const res = r.node(propsType);
  return res.props.length > 0 || res.inherits.length > 0 ? res : null;
}

/** `XTypeMap = ExtendFooTypeMap<{ … }>`에서 상속 출처를 텍스트로 덧붙인다(따라가지는 않는다) */
function withTypeMapInherits(read: ComponentProps, body: Statement[], name: string): ComponentProps {
  const find = (t: TSType, depth = 0): string | null => {
    if (depth > 4) return null;
    if (t.type === "TSTypeReference" && t.typeName.type === "Identifier") return t.typeName.name;
    if (t.type === "TSParenthesizedType") return find(t.typeAnnotation, depth + 1);
    if (t.type === "TSIntersectionType") {
      for (const part of t.types) {
        const f = find(part, depth + 1);
        if (f && /^Extend\w+TypeMap$/.test(f)) return f;
      }
    }
    return null;
  };
  for (const raw of body) {
    const s = unwrapExport(raw);
    if (s.type !== "TSTypeAliasDeclaration" || s.id.name !== `${name}TypeMap`) continue;
    const ref = find(s.typeAnnotation);
    const m = ref ? /^Extend(\w+)TypeMap$/.exec(ref) : null;
    const extra = [...(m ? [`${m[1]}OwnProps`] : []), "RootComponent HTML attributes"];
    return { props: read.props, inherits: [...new Set([...read.inherits, ...extra])] };
  }
  return read;
}

const INHERITS_MAX = 100;

/** inherits 텍스트 정리: 주석 제거, 공백 접기, 자기 참조(XProps) 제외, 100자 초과는 잘라 "…" */
function cleanInherits(res: ComponentProps | null, local: string): ComponentProps | null {
  if (!res) return res;
  const self = new RegExp(`\\b${local}Props\\b`);
  const seen = new Set<string>();
  const inherits: string[] = [];
  for (const raw of res.inherits) {
    let t = raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\s+/g, " ").replace(/< /g, "<").replace(/ >/g, ">").trim();
    if (t === "" || self.test(t)) continue;
    if (t.length > INHERITS_MAX) t = `${t.slice(0, INHERITS_MAX - 1)}…`;
    if (!seen.has(t)) {
      seen.add(t);
      inherits.push(t);
    }
  }
  return { props: res.props, inherits };
}

/** 선언 이름 `local`의 props */
export function propsOfDeclaration(src: DtsSource, local: string): ComponentProps | null {
  return cleanInherits(readDeclaration(src, local), local);
}

function readDeclaration(src: DtsSource, local: string): ComponentProps | null {
  const r = new Reader(src);
  for (const raw of src.body) {
    const s = unwrapExport(raw);
    if ((s.type === "FunctionDeclaration" || s.type === "TSDeclareFunction") && s.id?.name === local) {
      const t = paramType(s as never);
      return t ? fromParam(r, local, t, s.typeParameters as TSTypeParameterDeclaration | null | undefined) : null;
    }
    if (s.type === "ClassDeclaration" && s.id?.name === local) {
      const first = (s as { superTypeParameters?: { params: TSType[] } | null }).superTypeParameters?.params[0];
      return first ? r.node(first) : null;
    }
    if (s.type !== "VariableDeclaration") continue;
    for (const d of s.declarations) {
      if (d.id.type !== "Identifier" || d.id.name !== local) continue;
      const ann = d.id.typeAnnotation;
      const t = ann && ann.type === "TSTypeAnnotation" ? ann.typeAnnotation : null;
      if (t) {
        // (props: P) => … 함수 타입(교차 안에 있어도): 매개변수 타입이 props
        const fn = functionTypeIn(t);
        if (fn) {
          const pt = paramType(fn as never);
          if (pt) {
            const res = fromParam(r, local, pt, (fn as { typeParameters?: TSTypeParameterDeclaration | null }).typeParameters);
            if (nonEmpty(res)) return res;
          }
        }
        // React.FC<P> 류: 타입 인자가 곧 props
        if (t.type === "TSTypeReference" && t.typeParameters?.params[0] && COMPONENT_TYPE.test(refName(t))) {
          const direct = r.node(t.typeParameters.params[0]);
          if (nonEmpty(direct)) return direct;
        }
      }
      // MUI 배치: XOwnProps → XProps → XTypeMap['props']
      let fallback: ComponentProps | null = null;
      for (const cand of [`${local}OwnProps`, `${local}Props`]) {
        const read = r.decl(cand);
        if (nonEmpty(read)) return withTypeMapInherits(read, src.body, local);
        fallback ??= read;
      }
      const viaMap = propsFromTypeMap(r, local);
      if (nonEmpty(viaMap)) return viaMap;
      return viaMap ?? fallback;
    }
  }
  return null;
}

export type { PropInfo };
