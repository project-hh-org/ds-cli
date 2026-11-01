import fs from "node:fs/promises";
import path from "node:path";
import type { ClassDeclaration, Expression, Statement, VariableDeclarator } from "@babel/types";
import {
  moduleOfFile,
  parseTsx,
  readComponentDoc,
  readComponentProps,
  type CatalogComponent,
  type Index,
} from "@dsmith-dev/core";
import fg from "fast-glob";
import { compareCodeUnits, isComponentName, toCatalogProp } from "./names.js";

export const COMPONENT_FILE_GLOB = "**/*.{tsx,ts,jsx,js}";
export const NON_COMPONENT_FILES: readonly string[] = [
  "**/*.stories.*",
  "**/*.test.*",
  "**/*.spec.*",
  "**/*.d.ts",
  "**/__tests__/**",
  "**/node_modules/**",
];

const TOKENS_USED_MAX = 10;

interface ValueExport {
  /** 외부에 보이는 이름 */
  name: string;
  /** 같은 파일의 선언 이름 */
  local: string;
}

const DATA_INIT = new Set([
  "ObjectExpression",
  "ArrayExpression",
  "StringLiteral",
  "NumericLiteral",
  "BooleanLiteral",
  "NullLiteral",
  "BigIntLiteral",
  "RegExpLiteral",
  "TemplateLiteral",
]);

function unwrapInit(e: Expression): Expression {
  let n = e;
  while (n.type === "TSAsExpression" || n.type === "TSSatisfiesExpression" || n.type === "ParenthesizedExpression" || n.type === "TSNonNullExpression") n = n.expression;
  return n;
}

/** 객체·배열·리터럴을 초기값으로 가진 const는 컴포넌트가 아니다(옵션 맵, 상수) */
function isDataConst(d: VariableDeclarator): boolean {
  return d.init != null && DATA_INIT.has(unwrapInit(d.init).type);
}

/** 클래스는 React.Component·PureComponent를 상속할 때만 컴포넌트다 */
function isComponentClass(c: ClassDeclaration): boolean {
  const sup = c.superClass;
  if (!sup) return false;
  const name = sup.type === "Identifier" ? sup.name : sup.type === "MemberExpression" && !sup.computed && sup.property.type === "Identifier" ? sup.property.name : null;
  return name === "Component" || name === "PureComponent";
}

/** 파일 최상위의 컴포넌트가 될 수 있는 값 선언 이름(function · Component 클래스 · 데이터가 아닌 const/let/var) */
function declaredValues(body: Statement[]): Set<string> {
  const out = new Set<string>();
  for (const raw of body) {
    const s = (raw.type === "ExportNamedDeclaration" || raw.type === "ExportDefaultDeclaration") && raw.declaration ? raw.declaration : raw;
    if (s.type === "FunctionDeclaration" && s.id) out.add(s.id.name);
    else if (s.type === "ClassDeclaration" && s.id && isComponentClass(s)) out.add(s.id.name);
    else if (s.type === "VariableDeclaration") {
      for (const d of s.declarations) if (d.id.type === "Identifier" && !isDataConst(d)) out.add(d.id.name);
    }
  }
  return out;
}

/** export function X / export const X = / export class X / export default function X / export { X, Y as Z } / export default X */
function valueExports(body: Statement[]): ValueExport[] {
  const declared = declaredValues(body);
  const out: ValueExport[] = [];
  const push = (name: string, local: string): void => {
    if (declared.has(local) && isComponentName(name) && !out.some((e) => e.name === name)) out.push({ name, local });
  };
  for (const stmt of body) {
    if (stmt.type === "ExportNamedDeclaration") {
      const d = stmt.declaration;
      if (d) {
        if ((d.type === "FunctionDeclaration" || d.type === "ClassDeclaration") && d.id) push(d.id.name, d.id.name);
        else if (d.type === "VariableDeclaration") {
          for (const decl of d.declarations) if (decl.id.type === "Identifier") push(decl.id.name, decl.id.name);
        }
      } else if (!stmt.source) {
        for (const spec of stmt.specifiers) {
          if (spec.type !== "ExportSpecifier") continue;
          const exported = spec.exported.type === "Identifier" ? spec.exported.name : spec.exported.value;
          push(exported, spec.local.name);
        }
      }
    } else if (stmt.type === "ExportDefaultDeclaration") {
      const d = stmt.declaration;
      if ((d.type === "FunctionDeclaration" || d.type === "ClassDeclaration") && d.id) push(d.id.name, d.id.name);
      else if (d.type === "Identifier" && declared.has(d.name)) push(d.name, d.name);
    }
  }
  return out;
}

const BARREL_GLOB = "**/index.{tsx,ts,jsx,js}";

/**
 * dir 아래 index.* 배럴이 re-export하는 컴포넌트에 `modules`(file module + 배럴 module)를 붙인다.
 * `import { Button } from "@/components/ui"`의 사용 module은 배럴 module이라 파일 module만으로는 조인이 안 된다.
 * 지원: `export { X, Y as Z } from "./x"`, `export * from "./x"`, 배럴이 다른 배럴을 re-export하는 경우(3단계까지)
 */
async function attachBarrelModules(root: string, base: string, components: CatalogComponent[]): Promise<void> {
  const barrels = (await fg(`${base}${BARREL_GLOB}`, { cwd: root, ignore: [...NON_COMPONENT_FILES], dot: false }))
    .map((f) => f.split(path.sep).join("/"))
    .sort(compareCodeUnits);
  interface Parsed {
    module: string;
    named: { name: string; from: string }[];
    stars: string[];
  }
  const parsed: Parsed[] = [];
  for (const rel of barrels) {
    let body: Statement[];
    try {
      body = parseTsx(await fs.readFile(path.join(root, rel), "utf-8"), rel).program.body;
    } catch {
      continue;
    }
    const dirOf = path.posix.dirname(rel);
    const resolve = (spec: string): string | null => (spec.startsWith(".") ? moduleOfFile(path.posix.join(dirOf, spec)) : null);
    const p: Parsed = { module: moduleOfFile(rel), named: [], stars: [] };
    for (const stmt of body) {
      if (stmt.type === "ExportAllDeclaration") {
        const from = resolve(stmt.source.value);
        if (from !== null) p.stars.push(from);
      } else if (stmt.type === "ExportNamedDeclaration" && stmt.source) {
        const from = resolve(stmt.source.value);
        if (from === null) continue;
        for (const spec of stmt.specifiers) {
          if (spec.type !== "ExportSpecifier") continue;
          p.named.push({ name: spec.exported.type === "Identifier" ? spec.exported.name : spec.exported.value, from });
        }
      }
    }
    parsed.push(p);
  }
  const key = (c: { module: string; name: string }): string => `${c.module}\0${c.name}`;
  // 배럴 module → 그 배럴이 내보내는 컴포넌트 키
  const exportsOf = new Map<string, Set<string>>();
  for (const p of parsed) exportsOf.set(p.module, new Set());
  for (let pass = 0; pass < 3; pass++) {
    for (const p of parsed) {
      const set = exportsOf.get(p.module) as Set<string>;
      for (const c of components) {
        const k = key(c);
        if (p.stars.some((from) => c.module === from || exportsOf.get(from)?.has(k))) set.add(k);
        if (p.named.some((n) => n.name === c.name && (c.module === n.from || exportsOf.get(n.from)?.has(k)))) set.add(k);
      }
    }
  }
  for (const c of components) {
    const extra = [...exportsOf].filter(([module, set]) => module !== c.module && set.has(key(c))).map(([module]) => module).sort(compareCodeUnits);
    if (extra.length > 0) c.modules = [c.module, ...extra];
  }
}

/** dir(root 상대) 아래 파일의 export된 대문자 값 선언 → CatalogComponent */
export async function catalogFromDir(
  root: string,
  dir: string,
  origin: "ds-local" | "init",
  index: Index,
): Promise<{ components: CatalogComponent[]; warnings: string[] }> {
  const base = dir === "." || dir === "" ? "" : `${dir.replace(/\/+$/, "")}/`;
  const files = (
    await fg(`${base}${COMPONENT_FILE_GLOB}`, { cwd: root, ignore: [...NON_COMPONENT_FILES], dot: false })
  ).map((f) => f.split(path.sep).join("/"));
  files.sort(compareCodeUnits);

  const tokensByFile = new Map<string, string[]>();
  for (const u of index.styles) {
    if (u.source !== "token") continue;
    const list = tokensByFile.get(u.file) ?? [];
    if (!list.includes(u.raw) && list.length < TOKENS_USED_MAX) list.push(u.raw);
    tokensByFile.set(u.file, list);
  }

  const warnings: string[] = [];
  const components: CatalogComponent[] = [];
  const seen = new Map<string, string>();
  for (const rel of files) {
    let code: string;
    let body: Statement[];
    try {
      code = await fs.readFile(path.join(root, rel), "utf-8");
      body = parseTsx(code, rel).program.body;
    } catch {
      warnings.push(`파일을 읽을 수 없음: ${rel}`);
      continue;
    }
    for (const exp of valueExports(body)) {
      const prior = seen.get(exp.name);
      if (prior !== undefined) {
        warnings.push(`컴포넌트 이름 중복: ${exp.name} — ${prior} 사용, ${rel} 건너뜀`);
        continue;
      }
      seen.set(exp.name, rel);
      const read = readComponentProps(code, rel, exp.local);
      const props = (read?.props ?? []).map(toCatalogProp);
      const doc = readComponentDoc(code, rel, exp.local);
      const comp: CatalogComponent = {
        name: exp.name,
        module: moduleOfFile(rel),
        origin,
        file: rel,
        props,
        propsStatus: props.length > 0 ? "ok" : "none",
      };
      if (read && read.inherits.length > 0) comp.inherits = read.inherits;
      if (doc?.description !== undefined) comp.description = doc.description;
      if (doc?.deprecated !== undefined) comp.deprecated = doc.deprecated;
      const used = tokensByFile.get(rel);
      if (used && used.length > 0) comp.tokensUsed = used;
      components.push(comp);
    }
  }
  await attachBarrelModules(root, base, components);
  return { components, warnings };
}
