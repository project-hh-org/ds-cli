import { posix } from "node:path";
import type { Declaration, File, JSXMemberExpression, JSXOpeningElement, Statement } from "@babel/types";
import type { ComponentUsage } from "../model/component-usage.js";
import { traverse } from "../parse/tsx.js";
import {
  isBareSpecifier,
  normalizePackageSpecifier,
  normalizeSpecifier,
  resolveWithPaths,
  SOURCE_EXTENSION,
  stripModulePath,
  type TsPaths,
} from "./specifier.js";

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

/** module 해석에 쓰는 레포 단위 정보. indexRepo가 레포마다 한 번 모은다. */
export interface ModuleContext {
  /** `<root>/<baseUrl>` 바로 아래 항목 이름(디렉터리, 확장자를 뗀 소스 파일). bare import가 baseUrl 기준 경로인지 가린다. */
  baseUrlEntries?: ReadonlySet<string>;
  /** root package.json의 dependencies·devDependencies·peerDependencies 이름. */
  dependencies?: ReadonlySet<string>;
}

/**
 * 같은 모듈이면 같은 값이 되는 비교 키.
 * 상대 경로 → root 상대 경로, tsconfig paths 별칭 → paths로 푼 root 상대 경로(단, 패키지 모양 specifier가
 * root 밖을 가리키거나 의존성으로 선언된 패키지면 패키지명), 그 밖의 `@/`·`~/` → resolveSource 규칙,
 * baseUrl 아래 항목으로 시작하는 bare specifier → baseUrl 기준 경로(의존성으로 선언된 패키지명이면 제외),
 * 패키지 → 서브패스를 뗀 패키지명.
 * 경로는 확장자와 끝의 `/`·`/index`를 뗀다.
 */
function moduleOf(file: string, specifier: string, tsPaths: TsPaths | null, ctx: ModuleContext): string {
  if (specifier.startsWith(".")) return stripModulePath(resolveSource(file, specifier));
  const viaPaths = resolveWithPaths(specifier, file, tsPaths);
  if (viaPaths !== null) {
    // 모노레포 앱이 workspace 패키지를 소스로 매핑한 별칭: 루트·서브패스 import가 한 패키지로 모여야 한다.
    if (isBareSpecifier(specifier)) {
      const pkg = normalizePackageSpecifier(specifier);
      if (viaPaths.startsWith("../") || ctx.dependencies?.has(pkg) === true) return pkg;
    }
    return viaPaths;
  }
  if (PATH_ALIAS.test(specifier)) return stripModulePath(resolveSource(file, specifier));
  // 선언된 의존성은 baseUrl 아래 같은 이름의 항목보다 우선한다(node_modules 패키지로 본다).
  const declaredDependency = ctx.dependencies?.has(normalizePackageSpecifier(specifier)) === true;
  if (tsPaths !== null && isBareSpecifier(specifier) && !declaredDependency) {
    const first = specifier.split("/")[0] ?? "";
    if (ctx.baseUrlEntries?.has(first) === true) {
      return stripModulePath(posix.join(tsPaths.baseUrl === "" ? "." : tsPaths.baseUrl, specifier));
    }
  }
  return normalizePackageSpecifier(specifier);
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

/**
 * 파일 최상위에 선언한 이름: `function X`, `const/let/var X =`(구조 분해 제외), `class X`,
 * 그리고 이것들의 `export`·`export default` 형태.
 */
function topLevelDeclaredNames(ast: File): Set<string> {
  const names = new Set<string>();
  const add = (decl: Statement | Declaration | null | undefined): void => {
    if (decl === null || decl === undefined) return;
    if ((decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") && decl.id) names.add(decl.id.name);
    if (decl.type === "VariableDeclaration") {
      for (const d of decl.declarations) if (d.id.type === "Identifier") names.add(d.id.name);
    }
  };
  for (const stmt of ast.program.body) {
    if (stmt.type === "ExportNamedDeclaration") add(stmt.declaration);
    else if (stmt.type === "ExportDefaultDeclaration") {
      const d = stmt.declaration;
      if (d.type === "FunctionDeclaration" || d.type === "ClassDeclaration") add(d);
    } else add(stmt);
  }
  return names;
}

export function extractComponentUsage(
  file: string,
  ast: File,
  tsPaths: TsPaths | null = null,
  ctx: ModuleContext = {},
): ComponentUsage[] {
  const imports = new Map<string, { importedFrom: string; module: string }>();
  for (const stmt of ast.program.body) {
    if (stmt.type !== "ImportDeclaration") continue;
    const source = {
      importedFrom: resolveSource(file, stmt.source.value),
      module: moduleOf(file, stmt.source.value, tsPaths, ctx),
    };
    for (const spec of stmt.specifiers) imports.set(spec.local.name, source);
  }

  const declared = topLevelDeclaredNames(ast);
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
      const source = imports.get(found.root);
      const usage: ComponentUsage = {
        file,
        line,
        name: found.name,
        importedFrom: source?.importedFrom ?? null,
        module: source?.module ?? "",
        props,
      };
      if (source === undefined && declared.has(found.root)) usage.declaredLocally = true;
      usages.push(usage);
    },
  });
  return usages;
}
