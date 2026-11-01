// Storybook CSF: default export = 메타(`component`), 모든 named export = 스토리.
// 부록 B.5 — https://storybook.js.org/docs/api/csf (2026-11-01 확인). include/excludeStories·CSF Factories는 해석하지 않는다.
import fs from "node:fs/promises";
import path from "node:path";
import type { Node, Statement } from "@babel/types";
import { parseTsx } from "@dsmith-dev/core";
import fg from "fast-glob";

const STORY_GLOB = "**/*.stories.{tsx,ts,jsx,js}";

function posix(p: string): string {
  return p.split(path.sep).join("/");
}

function unwrap(node: Node): Node {
  let n = node;
  while (n.type === "TSAsExpression" || n.type === "TSSatisfiesExpression" || n.type === "ParenthesizedExpression" || n.type === "TSNonNullExpression") {
    n = n.expression;
  }
  return n;
}

/** 메타 객체의 `component: X` Identifier 이름 */
function metaComponent(body: Statement[]): string | null {
  // `import { Button as UIButton }` → UIButton은 Button
  const imported = new Map<string, string>();
  for (const s of body) {
    if (s.type !== "ImportDeclaration") continue;
    for (const spec of s.specifiers) {
      if (spec.type === "ImportSpecifier") {
        imported.set(spec.local.name, spec.imported.type === "Identifier" ? spec.imported.name : spec.imported.value);
      }
    }
  }
  const name = metaComponentLocal(body);
  return name === null ? null : (imported.get(name) ?? name);
}

function metaComponentLocal(body: Statement[]): string | null {
  const def = body.find((s) => s.type === "ExportDefaultDeclaration");
  if (!def || def.type !== "ExportDefaultDeclaration") return null;
  let node: Node = def.declaration;
  node = unwrap(node);
  if (node.type === "Identifier") {
    const name = node.name;
    let init: Node | null = null;
    for (const s of body) {
      const decl = s.type === "ExportNamedDeclaration" && s.declaration ? s.declaration : s;
      if (decl.type !== "VariableDeclaration") continue;
      for (const d of decl.declarations) {
        if (d.id.type === "Identifier" && d.id.name === name && d.init) init = d.init;
      }
    }
    if (!init) return null;
    node = unwrap(init);
  }
  if (node.type !== "ObjectExpression") return null;
  for (const p of node.properties) {
    if (p.type !== "ObjectProperty" || p.computed) continue;
    const key = p.key.type === "Identifier" ? p.key.name : p.key.type === "StringLiteral" ? p.key.value : null;
    if (key !== "component") continue;
    const v = unwrap(p.value);
    return v.type === "Identifier" ? v.name : null;
  }
  return null;
}

/** dir 아래 *.stories.*: 컴포넌트 이름(메타의 component → 없으면 파일명 앞부분) → stories 파일(root 상대 POSIX). 이름이 겹치면 경로 순 첫 파일 */
export async function findStories(root: string, dir: string): Promise<Map<string, string>> {
  const base = dir === "." || dir === "" ? "" : `${dir.replace(/\/+$/, "")}/`;
  const files = (
    await fg(`${base}${STORY_GLOB}`, { cwd: root, dot: false, ignore: ["**/node_modules/**"] })
  ).map(posix);
  files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const out = new Map<string, string>();
  for (const file of files) {
    let name: string | null = null;
    try {
      const code = await fs.readFile(path.join(root, file), "utf-8");
      name = metaComponent(parseTsx(code, file).program.body);
    } catch {
      name = null;
    }
    if (name === null) {
      const stem = (file.split("/").pop() ?? "").split(".")[0] ?? "";
      name = stem === "" ? null : stem;
    }
    if (name !== null && !out.has(name)) out.set(name, file);
  }
  return out;
}

/** 첫 named export(default 제외)의 소스. maxLines(기본 20)줄을 넘으면 그만큼 + "// …" */
export function storyExample(code: string, file: string, maxLines = 20): string | null {
  let body: Statement[];
  try {
    body = parseTsx(code, file).program.body;
  } catch {
    return null;
  }
  // 스토리는 값 선언(const·function)뿐 — `export type Story = …`·interface·declare는 건너뛴다
  const stmt = body.find(
    (s) =>
      s.type === "ExportNamedDeclaration" &&
      s.declaration != null &&
      (s.declaration.type === "VariableDeclaration" || s.declaration.type === "FunctionDeclaration") &&
      (s.declaration as { declare?: boolean }).declare !== true,
  );
  if (!stmt || stmt.start == null || stmt.end == null) return null;
  const lines = code.slice(stmt.start, stmt.end).replace(/\r\n/g, "\n").split("\n");
  if (lines.length <= maxLines) return lines.join("\n");
  return `${lines.slice(0, maxLines).join("\n")}\n// …`;
}
