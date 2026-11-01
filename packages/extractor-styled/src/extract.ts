import { parseTsx, traverse } from "@dsmith/core";
import { JS_FILES } from "@dsmith/extractor-api";
import type { ExtractContext, Extractor, StyleUsage } from "@dsmith/extractor-api";
import type { Expression, Node, ObjectExpression, Program } from "@babel/types";
import { usagesFromObject, usagesFromTemplate } from "./template.js";
import { write } from "./write.js";

export const EXTRACTOR_NAME = "styled";

/** 파일의 CSS-in-JS 관련 import 로컬 이름. 없으면 null. */
export interface StyleImports {
  /** `styled-components`의 default(또는 named `styled`) */
  styled: string | null;
  /** `styled-components`의 `css` */
  scCss: string | null;
  /** `styled-components`의 `createGlobalStyle` */
  createGlobalStyle: string | null;
  /** `@emotion/styled`의 default */
  emotionStyled: string | null;
  /** `@emotion/react` 또는 `@emotion/css`의 `css` */
  emotionCss: string | null;
  /** import 문이 묶은 모든 로컬 이름(출처 무관) */
  bound: Set<string>;
  fromStyledComponents: boolean;
  fromEmotion: boolean;
}

export function readStyleImports(program: Program): StyleImports {
  const imports: StyleImports = {
    styled: null,
    scCss: null,
    createGlobalStyle: null,
    emotionStyled: null,
    emotionCss: null,
    bound: new Set(),
    fromStyledComponents: false,
    fromEmotion: false,
  };
  for (const stmt of program.body) {
    if (stmt.type !== "ImportDeclaration") continue;
    const source = stmt.source.value;
    // `styled-components/native`·`/macro`, `@emotion/styled/macro`·`@emotion/native`도 같은 API다.
    const sc = source === "styled-components" || source.startsWith("styled-components/");
    const emotion = source.startsWith("@emotion/");
    const emotionStyled = source === "@emotion/styled" || source === "@emotion/styled/macro" || source === "@emotion/native";
    const isType = (spec: (typeof stmt.specifiers)[number]): boolean =>
      stmt.importKind === "type" || (spec.type === "ImportSpecifier" && spec.importKind === "type");
    for (const spec of stmt.specifiers) imports.bound.add(spec.local.name);
    // 타입만 가져오는 import(`import type { DefaultTheme } from "styled-components"`)는 귀속에 영향을 주지 않는다.
    const valueSpecs = stmt.specifiers.filter((spec) => !isType(spec));
    if (stmt.importKind === "type" || (stmt.specifiers.length > 0 && valueSpecs.length === 0)) continue;
    if (sc) imports.fromStyledComponents = true;
    if (emotion) imports.fromEmotion = true;
    for (const spec of valueSpecs) {
      const local = spec.local.name;
      const imported =
        spec.type === "ImportDefaultSpecifier"
          ? "default"
          : spec.type === "ImportSpecifier"
            ? spec.imported.type === "Identifier"
              ? spec.imported.name
              : spec.imported.value
            : null;
      if (sc) {
        if (imported === "default" || imported === "styled") imports.styled = local;
        else if (imported === "css") imports.scCss = local;
        else if (imported === "createGlobalStyle") imports.createGlobalStyle = local;
      } else if (emotionStyled && imported === "default") {
        imports.emotionStyled = local;
      } else if ((source === "@emotion/react" || source === "@emotion/css") && imported === "css") {
        imports.emotionCss = local;
      }
    }
  }
  return imports;
}

/** 한 Extractor가 맡는 식별자. */
export interface Owned {
  /** `styled.x` / `styled(X)` 팩토리 이름 */
  styled: ReadonlySet<string>;
  /** 그 자체가 태그·함수인 이름(`css`, `createGlobalStyle`) */
  tags: ReadonlySet<string>;
  /** JSX `css` prop을 볼지 */
  cssProp: boolean;
}

const FACTORY_METHODS: ReadonlySet<string> = new Set(["attrs", "withConfig"]);

/** `styled.x`, `styled(X)`, 그리고 그 뒤의 `.attrs(...)`/`.withConfig(...)` 호출. 스타일을 받을 준비가 된 팩토리 식. */
function isStyledTarget(node: Node, names: ReadonlySet<string>): boolean {
  if (node.type === "MemberExpression") {
    return !node.computed && node.object.type === "Identifier" && names.has(node.object.name);
  }
  if (node.type === "CallExpression") {
    const callee = node.callee;
    if (callee.type === "Identifier") return names.has(callee.name);
    return (
      callee.type === "MemberExpression" &&
      !callee.computed &&
      callee.property.type === "Identifier" &&
      FACTORY_METHODS.has(callee.property.name) &&
      isStyledTarget(callee.object, names)
    );
  }
  return false;
}

/** 스타일 인자에서 객체 리터럴: 객체 자체, 또는 객체를 돌려주는 함수(`p => ({...})`, `p => { return {...} }`). */
export function styleObjectsOf(node: Node): ObjectExpression[] {
  if (node.type === "ObjectExpression") return [node];
  if (node.type !== "ArrowFunctionExpression" && node.type !== "FunctionExpression") return [];
  if (node.body.type === "ObjectExpression") return [node.body];
  if (node.body.type !== "BlockStatement") return [];
  const objects: ObjectExpression[] = [];
  for (const stmt of node.body.body) {
    if (stmt.type === "ReturnStatement" && stmt.argument?.type === "ObjectExpression") objects.push(stmt.argument);
  }
  return objects;
}

/**
 * styled·emotion 공용 추출. `owned`가 고른 식별자에 뿌리를 둔 태그 템플릿·객체 호출, 그리고(`cssProp`) JSX `css` prop만 본다.
 * `owned(imports)`가 Extractor별 귀속을 정한다 — 두 Extractor가 같은 파일을 봐도 같은 식을 두 번 세지 않는다.
 */
export function extractCssInJs(
  ctx: ExtractContext,
  extractorName: string,
  owned: (imports: StyleImports) => Owned,
): StyleUsage[] {
  // 복구 불가능한 문법 오류는 그대로 던진다. 파일 단위 실패 기록은 호출자(indexer) 몫이다.
  const ast = parseTsx(ctx.code, ctx.file);
  const imports = readStyleImports(ast.program);
  const own = owned(imports);
  if (own.styled.size === 0 && own.tags.size === 0 && !own.cssProp) return [];

  const usages: StyleUsage[] = [];
  const fromObjects = (node: Node): void => {
    for (const obj of styleObjectsOf(node)) usages.push(...usagesFromObject(obj, ctx, extractorName));
  };

  /** css prop 값. import 없는 `css\`…\``는 태그 방문에서 맡지 않으므로 여기서 본다. */
  const fromCssProp = (node: Expression): void => {
    if (node.type === "ArrayExpression") {
      for (const el of node.elements) if (el !== null && el.type !== "SpreadElement") fromCssProp(el);
      return;
    }
    if (node.type === "ConditionalExpression") {
      fromCssProp(node.consequent);
      fromCssProp(node.alternate);
      return;
    }
    if (node.type === "LogicalExpression") {
      fromCssProp(node.right);
      return;
    }
    if (node.type === "TaggedTemplateExpression") {
      if (node.tag.type === "Identifier" && node.tag.name === "css" && !imports.bound.has("css")) {
        usages.push(...usagesFromTemplate(node.quasi, ctx, extractorName));
      }
      return;
    }
    if (isStyleReference(node)) {
      pushReference(node);
      return;
    }
    fromObjects(node);
  };

  /** 다른 곳에 정의된 스타일 참조(`s`, `styles.x`, `make()`). 맡은 `css(...)`·`styled(...)` 호출은 CallExpression 방문이 센다. */
  const isStyleReference = (node: Expression): boolean => {
    switch (node.type) {
      case "Identifier":
        return node.name !== "undefined";
      case "MemberExpression":
      case "OptionalMemberExpression":
      case "OptionalCallExpression":
        return true;
      case "CallExpression": {
        const owns = node.callee.type === "Identifier" && own.tags.has(node.callee.name);
        return !owns && !isStyledTarget(node.callee, own.styled);
      }
      default:
        return false;
    }
  };

  /** 값을 알 수 없지만 커버리지에서 빠지지 않도록 참조 하나를 dynamic `other` 한 건으로 센다. 치환 구간은 없다. */
  const pushReference = (node: Expression): void => {
    const { start, end, loc } = node;
    if (start == null || end == null || loc == null) return;
    usages.push({
      file: ctx.file,
      line: loc.start.line,
      column: loc.start.column,
      property: "other",
      raw: ctx.code.slice(start, end),
      normalized: { kind: "unknown" },
      source: "dynamic",
      extractor: extractorName,
    });
  };

  traverse(ast, {
    TaggedTemplateExpression(path) {
      const { tag, quasi } = path.node;
      const isTag = tag.type === "Identifier" && own.tags.has(tag.name);
      if (isTag || isStyledTarget(tag, own.styled)) usages.push(...usagesFromTemplate(quasi, ctx, extractorName));
    },
    CallExpression(path) {
      const { callee, arguments: args } = path.node;
      const isTag = callee.type === "Identifier" && own.tags.has(callee.name);
      if (!isTag && !isStyledTarget(callee, own.styled)) return;
      for (const arg of args) fromObjects(arg);
    },
    JSXAttribute(path) {
      if (!own.cssProp) return;
      const { name, value } = path.node;
      if (name.type !== "JSXIdentifier" || name.name !== "css") return;
      if (value?.type !== "JSXExpressionContainer" || value.expression.type === "JSXEmptyExpression") return;
      fromCssProp(value.expression);
    },
  });
  // css prop은 자식 템플릿보다 먼저 방문되므로 소스 순서로 되돌린다.
  return usages.sort((a, b) => a.line - b.line || a.column - b.column);
}

function nonNull(...names: (string | null)[]): Set<string> {
  return new Set(names.filter((n): n is string => n !== null));
}

/**
 * styled-components 귀속: `styled-components`에서 import한 `styled`·`css`·`createGlobalStyle`.
 * `styled`라는 이름이 어디서도 import되지 않았으면 그 전역 `styled`도 맡는다(`@emotion/styled`·MUI 등에서 온 것은 제외).
 */
function ownedByStyled(imports: StyleImports): Owned {
  const implicitStyled = imports.styled === null && !imports.bound.has("styled") ? "styled" : null;
  const globalStyle = imports.createGlobalStyle ?? (imports.bound.has("createGlobalStyle") ? null : "createGlobalStyle");
  return {
    styled: nonNull(imports.styled, implicitStyled),
    tags: nonNull(imports.scCss, globalStyle),
    cssProp: false,
  };
}

const JS_FILE = /\.[cm]?[jt]sx?$/;

export const styledExtractor: Extractor = {
  name: EXTRACTOR_NAME,
  files: JS_FILES,
  parses: "tsx",
  signals: { dependencies: ["styled-components"] },
  appliesTo: (ctx) =>
    JS_FILE.test(ctx.file) &&
    (ctx.code.includes("styled") || ctx.code.includes("createGlobalStyle") || ctx.code.includes("css`")),
  extract: (ctx) => extractCssInJs(ctx, EXTRACTOR_NAME, ownedByStyled),
  write,
};
