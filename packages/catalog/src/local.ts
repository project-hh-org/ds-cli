import fs from "node:fs/promises";
import path from "node:path";
import type { Statement } from "@babel/types";
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

/** 파일 최상위의 값 선언 이름(function·class·const/let/var) */
function declaredValues(body: Statement[]): Set<string> {
  const out = new Set<string>();
  for (const raw of body) {
    const s = (raw.type === "ExportNamedDeclaration" || raw.type === "ExportDefaultDeclaration") && raw.declaration ? raw.declaration : raw;
    if ((s.type === "FunctionDeclaration" || s.type === "ClassDeclaration") && s.id) out.add(s.id.name);
    else if (s.type === "VariableDeclaration") {
      for (const d of s.declarations) if (d.id.type === "Identifier") out.add(d.id.name);
    }
  }
  return out;
}

/** export function X / export const X = / export class X / export default function X / export { X, Y as Z } / export default X */
function valueExports(body: Statement[]): ValueExport[] {
  const declared = declaredValues(body);
  const out: ValueExport[] = [];
  const push = (name: string, local: string): void => {
    if (isComponentName(name) && !out.some((e) => e.name === name)) out.push({ name, local });
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
          if (declared.has(spec.local.name)) push(exported, spec.local.name);
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
  return { components, warnings };
}
