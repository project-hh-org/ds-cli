// npm DS의 타입 선언(.d.ts/.d.mts)에서 컴포넌트와 props를 읽는다.
// 부록 B.3(Babel 7 dts 파싱·AST 이름) · B.4(MUI 6.5.0/9.5.0 배치) — 2026-11-01 확인
//   https://babeljs.io/docs/babel-parser , npm pack @mui/material@6.5.0 @mui/material@9.5.0
// 규칙: 이름 있는 re-export는 최대 maxHops(기본 3)까지, `export *`는 1단계(그 파일의 직접 선언만).
import fs from "node:fs/promises";
import path from "node:path";
import type { Statement } from "@babel/types";
import { parseTsx, readComponentDoc, type ComponentDoc, type ComponentProps } from "@dsmith-dev/core";
import { propsOfDeclaration, stripTypeParameters, type DtsSource } from "./dts-props.js";
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
  codes: Map<string, DtsSource | null>;
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

async function load(ctx: Ctx, file: string): Promise<DtsSource | null> {
  if (ctx.codes.has(file)) return ctx.codes.get(file) ?? null;
  let entry: DtsSource | null = null;
  try {
    const code = await fs.readFile(file, "utf-8");
    const body = parseTsx(code, file).program.body;
    entry = { code, plain: stripTypeParameters(code, body), file, body };
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
      props: propsOfDeclaration(loaded, res.local),
      doc: readComponentDoc(loaded.code, res.file, res.local),
    });
  }
  return { components, warnings: ctx.warnings };
}
