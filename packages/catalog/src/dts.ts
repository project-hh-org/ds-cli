// npm DS의 타입 선언(.d.ts/.d.mts)에서 컴포넌트와 props를 읽는다.
// 부록 B.3(Babel 7 dts 파싱·AST 이름) · B.4(MUI 6.5.0/9.5.0 배치) — 2026-11-01 확인
//   https://babeljs.io/docs/babel-parser , npm pack @mui/material@6.5.0 @mui/material@9.5.0
// 규칙: 이름 있는 re-export는 최대 maxHops(기본 3)까지, `export *`는 1단계(그 파일의 직접 선언만).
import fs from "node:fs/promises";
import path from "node:path";
import type { Node, Statement, TSType } from "@babel/types";
import {
  parseTsx,
  readComponentDoc,
  readTypeProps,
  type ComponentDoc,
  type ComponentProps,
} from "@dsmith-dev/core";
import { isComponentName } from "./names.js";

export interface DtsComponent {
  name: string;
  /** 선언 파일(절대 경로) */
  file: string;
  props: ComponentProps | null;
  doc: ComponentDoc | null;
}

interface Resolved {
  file: string;
  local: string;
}

interface Ctx {
  packageRoot: string;
  maxHops: number;
  warnings: string[];
  codes: Map<string, { code: string; body: Statement[] } | null>;
}

const SPECIFIER_SWAP: Record<string, string> = { ".js": ".d.ts", ".mjs": ".d.mts", ".cjs": ".d.cts" };

async function isFile(abs: string): Promise<boolean> {
  try {
    return (await fs.stat(abs)).isFile();
  } catch {
    return false;
  }
}

function inside(root: string, abs: string): boolean {
  const rel = path.relative(root, abs);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** 상대 지정자 → 선언 파일(패키지 밖·없음 → null) */
async function resolveSpecifier(ctx: Ctx, from: string, spec: string): Promise<string | null> {
  if (!spec.startsWith(".")) return null;
  const abs = path.resolve(path.dirname(from), spec);
  const ext = path.extname(spec);
  const candidates: string[] = [];
  const swapped = SPECIFIER_SWAP[ext];
  if (swapped !== undefined) candidates.push(abs.slice(0, -ext.length) + swapped);
  else candidates.push(`${abs}.d.ts`, `${abs}.d.mts`, path.join(abs, "index.d.ts"), path.join(abs, "index.d.mts"));
  for (const c of candidates) {
    if (!inside(ctx.packageRoot, c)) continue;
    if (await isFile(c)) return c;
  }
  return null;
}

async function load(ctx: Ctx, file: string): Promise<{ code: string; body: Statement[] } | null> {
  if (ctx.codes.has(file)) return ctx.codes.get(file) ?? null;
  let entry: { code: string; body: Statement[] } | null = null;
  try {
    const code = await fs.readFile(file, "utf-8");
    entry = { code, body: parseTsx(code, file).program.body };
  } catch {
    ctx.warnings.push(`선언 파일을 읽을 수 없음: ${path.relative(ctx.packageRoot, file).split(path.sep).join("/")}`);
  }
  ctx.codes.set(file, entry);
  return entry;
}

function rel(ctx: Ctx, file: string): string {
  return path.relative(ctx.packageRoot, file).split(path.sep).join("/");
}

const exportedName = (n: { type: string; name?: string; value?: string }): string => (n.type === "Identifier" ? (n.name as string) : (n.value as string));

/** 값 선언(declare const/function/class, export const/function/class)의 이름 → 선언 이름 */
function valueDeclarations(body: Statement[]): Set<string> {
  const out = new Set<string>();
  for (const raw of body) {
    const s = (raw.type === "ExportNamedDeclaration" || raw.type === "ExportDefaultDeclaration") && raw.declaration ? raw.declaration : raw;
    if ((s.type === "FunctionDeclaration" || s.type === "TSDeclareFunction" || s.type === "ClassDeclaration") && s.id) out.add(s.id.name);
    else if (s.type === "VariableDeclaration") {
      for (const d of s.declarations) if (d.id.type === "Identifier") out.add(d.id.name);
    }
  }
  return out;
}

/** 파일이 직접 내보내는 값: 이름 → 선언. `export default X`는 "default"로 */
function directExports(file: string, body: Statement[]): Map<string, Resolved> {
  const declared = valueDeclarations(body);
  const out = new Map<string, Resolved>();
  for (const stmt of body) {
    if (stmt.type === "ExportNamedDeclaration") {
      const d = stmt.declaration;
      if (d) {
        if ((d.type === "FunctionDeclaration" || d.type === "TSDeclareFunction" || d.type === "ClassDeclaration") && d.id) {
          out.set(d.id.name, { file, local: d.id.name });
        } else if (d.type === "VariableDeclaration") {
          for (const decl of d.declarations) if (decl.id.type === "Identifier") out.set(decl.id.name, { file, local: decl.id.name });
        }
      } else if (!stmt.source) {
        for (const spec of stmt.specifiers) {
          if (spec.type !== "ExportSpecifier") continue;
          if (declared.has(spec.local.name)) out.set(exportedName(spec.exported), { file, local: spec.local.name });
        }
      }
    } else if (stmt.type === "ExportDefaultDeclaration") {
      const d = stmt.declaration;
      if (d.type === "Identifier" && declared.has(d.name)) out.set("default", { file, local: d.name });
      else if ((d.type === "FunctionDeclaration" || d.type === "TSDeclareFunction" || d.type === "ClassDeclaration") && d.id) {
        out.set("default", { file, local: d.id.name });
      }
    }
  }
  return out;
}

/** 파일이 내보내는 값 전체(이름 있는 re-export는 hop+1로 따라감). stack = 순환 검출용 */
async function exportsOf(ctx: Ctx, file: string, hop: number, stack: string[]): Promise<Map<string, Resolved>> {
  const loaded = await load(ctx, file);
  if (!loaded) return new Map();
  const out = directExports(file, loaded.body);
  for (const stmt of loaded.body) {
    if (stmt.type === "ExportAllDeclaration") {
      // 1단계: 대상 파일의 직접 선언 중 값 export만(default 제외)
      const target = await resolveSpecifier(ctx, file, stmt.source.value);
      if (!target) continue;
      const t = await load(ctx, target);
      if (!t) continue;
      for (const [name, res] of directExports(target, t.body)) {
        if (name !== "default" && !out.has(name)) out.set(name, res);
      }
    } else if (stmt.type === "ExportNamedDeclaration" && stmt.source) {
      const target = await resolveSpecifier(ctx, file, stmt.source.value);
      if (!target) continue;
      if (stack.includes(target)) {
        ctx.warnings.push(`순환 re-export: ${rel(ctx, file)} → ${rel(ctx, target)}`);
        continue;
      }
      if (hop + 1 > ctx.maxHops) {
        ctx.warnings.push(`re-export ${ctx.maxHops}홉 초과: ${rel(ctx, file)} → ${rel(ctx, target)} 건너뜀`);
        continue;
      }
      const inner = await exportsOf(ctx, target, hop + 1, [...stack, target]);
      for (const spec of stmt.specifiers) {
        if (spec.type !== "ExportSpecifier") continue;
        const res = inner.get(spec.local.name);
        const name = exportedName(spec.exported);
        if (res && !out.has(name)) out.set(name, res);
      }
    }
  }
  return out;
}

function textOf(code: string, node: Node): string {
  return code.slice(node.start ?? 0, node.end ?? 0);
}

/** 인라인 타입(리터럴·교차)을 별칭으로 감싸 readTypeProps로 읽는다. JSDoc은 슬라이스에 그대로 들어간다 */
function propsOfTypeNode(code: string, file: string, t: TSType): ComponentProps | null {
  if (t.type === "TSTypeReference" && t.typeName.type === "Identifier" && !t.typeParameters) {
    return readTypeProps(code, file, t.typeName.name);
  }
  if (t.type === "TSTypeLiteral" || t.type === "TSIntersectionType") {
    return readTypeProps(`type __T = ${textOf(code, t)};\n`, "__t.d.ts", "__T");
  }
  return null;
}

function nonEmpty(p: ComponentProps | null): p is ComponentProps {
  return p !== null && p.props.length > 0;
}

/** `${X}TypeMap`의 `props` 멤버: 교차의 타입 리터럴 부분 + 같은 파일 interface 참조 */
function propsFromTypeMap(code: string, file: string, body: Statement[], name: string): ComponentProps | null {
  let alias: TSType | null = null;
  for (const raw of body) {
    const s = raw.type === "ExportNamedDeclaration" && raw.declaration ? raw.declaration : raw;
    if (s.type === "TSTypeAliasDeclaration" && s.id.name === `${name}TypeMap`) alias = s.typeAnnotation;
  }
  if (!alias) return null;
  // 타입 인자/직접 리터럴 중 `props` 멤버를 가진 TSTypeLiteral을 찾는다
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
    }
  };
  visit(alias);
  if (!propsType) return null;
  const parts: TSType[] = (propsType as TSType).type === "TSIntersectionType" ? (propsType as { types: TSType[] }).types : [propsType as TSType];
  const result: ComponentProps = { props: [], inherits: [] };
  for (const part of parts) {
    if (part.type === "TSTypeReference" && part.typeName.type === "Identifier" && !part.typeParameters) {
      const read = readTypeProps(code, file, part.typeName.name);
      if (read) {
        result.props.push(...read.props);
        result.inherits.push(...read.inherits);
      } else {
        result.inherits.push(part.typeName.name);
      }
    } else if (part.type === "TSTypeLiteral") {
      const read = propsOfTypeNode(code, file, part);
      if (read) result.props.push(...read.props);
    } else {
      result.inherits.push(textOf(code, part).replace(/\s+/g, " ").trim());
    }
  }
  return result.props.length > 0 || result.inherits.length > 0 ? result : null;
}

/**
 * `type XProps = AProps | BProps`(같은 파일 interface 참조의 유니온): 변형을 병합한다.
 * 같은 이름 prop은 values를 합집합으로, 나머지 필드는 먼저 나온 것을 유지. 하나라도 못 읽으면 null
 */
function propsOfUnionAlias(code: string, file: string, body: Statement[], name: string): ComponentProps | null {
  let alias: TSType | null = null;
  for (const raw of body) {
    const s = raw.type === "ExportNamedDeclaration" && raw.declaration ? raw.declaration : raw;
    if (s.type === "TSTypeAliasDeclaration" && s.id.name === name && !s.typeParameters) alias = s.typeAnnotation;
  }
  if (!alias || alias.type !== "TSUnionType") return null;
  const merged: ComponentProps = { props: [], inherits: [] };
  for (const part of alias.types) {
    if (part.type !== "TSTypeReference" || part.typeName.type !== "Identifier") return null;
    const read = readTypeProps(code, file, part.typeName.name);
    if (!read) return null;
    for (const p of read.props) {
      const prior = merged.props.find((x) => x.name === p.name);
      if (!prior) merged.props.push({ ...p });
      else if (p.values) prior.values = [...new Set([...(prior.values ?? []), ...p.values])];
    }
    for (const i of read.inherits) if (!merged.inherits.includes(i)) merged.inherits.push(i);
  }
  return merged;
}

/** `XTypeMap = ExtendFooTypeMap<{ props: …; defaultComponent: … }>`에서 상속 출처를 텍스트로 덧붙인다(따라가지는 않는다) */
function withTypeMapInherits(read: ComponentProps, body: Statement[], name: string): ComponentProps {
  for (const raw of body) {
    const s = raw.type === "ExportNamedDeclaration" && raw.declaration ? raw.declaration : raw;
    if (s.type !== "TSTypeAliasDeclaration" || s.id.name !== `${name}TypeMap`) continue;
    const t = s.typeAnnotation;
    if (t.type !== "TSTypeReference" || t.typeName.type !== "Identifier") continue;
    const m = /^Extend(\w+)TypeMap$/.exec(t.typeName.name);
    const extra = [...(m ? [`${m[1]}OwnProps`] : []), "RootComponent HTML attributes"];
    return { props: read.props, inherits: [...new Set([...read.inherits, ...extra])] };
  }
  return read;
}

function paramType(fn: { params: Node[] }): TSType | null {
  const p = fn.params[0];
  if (!p) return null;
  const target = p.type === "AssignmentPattern" ? p.left : p;
  const ann = (target as { typeAnnotation?: Node | null }).typeAnnotation;
  return ann && ann.type === "TSTypeAnnotation" ? ann.typeAnnotation : null;
}

/** 선언 이름 `local`의 props */
function propsOfDeclaration(code: string, file: string, body: Statement[], local: string): ComponentProps | null {
  for (const raw of body) {
    const s = (raw.type === "ExportNamedDeclaration" || raw.type === "ExportDefaultDeclaration") && raw.declaration ? raw.declaration : raw;
    if ((s.type === "FunctionDeclaration" || s.type === "TSDeclareFunction") && s.id?.name === local) {
      const t = paramType(s);
      return t ? propsOfTypeNode(code, file, t) : null;
    }
    if (s.type === "ClassDeclaration" && s.id?.name === local) {
      const args = (s as { superTypeParameters?: { params: TSType[] } | null }).superTypeParameters;
      const first = args?.params[0];
      return first ? propsOfTypeNode(code, file, first) : null;
    }
    if (s.type === "VariableDeclaration") {
      for (const d of s.declarations) {
        if (d.id.type !== "Identifier" || d.id.name !== local) continue;
        const ann = d.id.typeAnnotation;
        const t = ann && ann.type === "TSTypeAnnotation" ? ann.typeAnnotation : null;
        // React.FC<P> 류: 타입 인자가 곧 props
        if (t && t.type === "TSTypeReference" && t.typeParameters?.params[0]) {
          const direct = propsOfTypeNode(code, file, t.typeParameters.params[0]);
          if (nonEmpty(direct)) return direct;
        }
        // MUI 배치: XOwnProps → XProps(유니온이면 변형 병합) → XTypeMap['props']
        let fallback: ComponentProps | null = null;
        for (const candidate of [`${local}OwnProps`, `${local}Props`]) {
          const read = readTypeProps(code, file, candidate) ?? propsOfUnionAlias(code, file, body, candidate);
          if (nonEmpty(read)) return withTypeMapInherits(read, body, local);
          fallback ??= read;
        }
        const viaMap = propsFromTypeMap(code, file, body, local);
        if (nonEmpty(viaMap)) return viaMap;
        return viaMap ?? fallback;
      }
    }
  }
  return null;
}

/** 엔트리 d.ts에서 대문자 값 export를 모아 선언 파일까지 따라간다 */
export async function componentsFromDts(
  entryAbs: string,
  opts: { maxHops?: number; packageRoot?: string } = {},
): Promise<{ components: DtsComponent[]; warnings: string[] }> {
  const ctx: Ctx = {
    packageRoot: opts.packageRoot ?? path.dirname(entryAbs),
    maxHops: opts.maxHops ?? 3,
    warnings: [],
    codes: new Map(),
  };
  const exported = await exportsOf(ctx, entryAbs, 0, [entryAbs]);
  const components: DtsComponent[] = [];
  const names = [...exported.keys()].filter((n) => n !== "default" && isComponentName(n)).sort();
  for (const name of names) {
    const res = exported.get(name) as Resolved;
    const loaded = await load(ctx, res.file);
    if (!loaded) continue;
    components.push({
      name,
      file: res.file,
      props: propsOfDeclaration(loaded.code, res.file, loaded.body, res.local),
      doc: readComponentDoc(loaded.code, res.file, res.local),
    });
  }
  return { components, warnings: ctx.warnings };
}
