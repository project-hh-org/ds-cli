import { posix } from "node:path";
import type { File, JSXMemberExpression, JSXOpeningElement } from "@babel/types";
import type { ComponentUsage } from "../model/component-usage.js";
import { traverse } from "../parse/tsx.js";
import { normalizeSpecifier } from "./specifier.js";

const SOURCE_EXTENSION = /\.(?:[cm]?[jt]sx?)$/;
const PATH_ALIAS = /^[@~]\//;

/**
 * 상대 경로 specifier는 importer 디렉터리 기준으로 풀어 root 상대 POSIX 경로(확장자 없음)로, 패키지명은 그대로 둔다.
 * `@/`·`~/` 별칭은 importer가 `src/` 아래면 `src/` 기준(Next·Vite 관례), 아니면 root 기준으로 풀어
 * 같은 모듈을 상대 경로로 import한 것과 같은 값이 되게 한다.
 */
function resolveSource(file: string, specifier: string): string {
  if (specifier.startsWith(".")) return posix.join(posix.dirname(file), specifier).replace(SOURCE_EXTENSION, "");
  if (PATH_ALIAS.test(specifier)) {
    const base = file.startsWith("src/") ? "src/" : "";
    return `${base}${normalizeSpecifier(specifier)}`.replace(SOURCE_EXTENSION, "");
  }
  return specifier;
}

function memberRoot(name: JSXMemberExpression): string | null {
  let object = name.object;
  while (object.type === "JSXMemberExpression") object = object.object;
  return object.type === "JSXIdentifier" ? object.name : null;
}

function memberText(name: JSXMemberExpression): string {
  const object = name.object.type === "JSXMemberExpression" ? memberText(name.object) : name.object.name;
  return `${object}.${name.property.name}`;
}

/** 컴포넌트로 볼 이름(대문자로 시작하는 식별자 또는 멤버 표현식)과 import 해석에 쓸 루트 식별자. */
function componentName(node: JSXOpeningElement): { name: string; root: string } | null {
  const { name } = node;
  if (name.type === "JSXIdentifier") {
    return /^[A-Z]/.test(name.name) ? { name: name.name, root: name.name } : null;
  }
  if (name.type === "JSXMemberExpression") {
    const root = memberRoot(name);
    return root !== null && /^[A-Z]/.test(root) ? { name: memberText(name), root } : null;
  }
  return null;
}

export function extractComponentUsage(file: string, ast: File): ComponentUsage[] {
  const imports = new Map<string, string>();
  for (const stmt of ast.program.body) {
    if (stmt.type !== "ImportDeclaration") continue;
    const source = resolveSource(file, stmt.source.value);
    for (const spec of stmt.specifiers) imports.set(spec.local.name, source);
  }

  const usages: ComponentUsage[] = [];
  traverse(ast, {
    JSXOpeningElement(path) {
      const found = componentName(path.node);
      const line = path.node.loc?.start.line;
      if (found === null || line === undefined) return;
      const props: string[] = [];
      for (const attr of path.node.attributes) {
        if (attr.type !== "JSXAttribute") continue;
        props.push(attr.name.type === "JSXIdentifier" ? attr.name.name : `${attr.name.namespace.name}:${attr.name.name.name}`);
      }
      usages.push({
        file,
        line,
        name: found.name,
        importedFrom: imports.get(found.root) ?? null,
        props,
      });
    },
  });
  return usages;
}
