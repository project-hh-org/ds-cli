import { normalizeColor, parseTsx, traverse, usagesFromStyleObject } from "@dsmith-dev/core";
import type { StyleObjectContext, StyleObjectUsage } from "@dsmith-dev/core";
import { JS_FILES } from "@dsmith-dev/extractor-api";
import type { ExtractContext, Extractor, StyleUsage } from "@dsmith-dev/extractor-api";
import type { Expression, ObjectExpression, ObjectProperty } from "@babel/types";
import { MUI_KEY_MAP, SHAPE_BORDER_RADIUS_PX, isPalettePath, isSpacingProp, spacingToPx } from "./theme-scale.js";
import { registerPatchTarget, tokenRef, write } from "./write.js";

export const EXTRACTOR_NAME = "mui-sx";

const JS_FILE = /\.[cm]?[jt]sx?$/;
/** 숫자 0 초과 1 이하가 비율(`1` = 100%)로 읽히는 크기 키. */
const SIZE_KEYS: ReadonlySet<string> = new Set(["width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight"]);
const PALETTE_KEYS: ReadonlySet<string> = new Set(["color", "bgcolor", "backgroundColor", "borderColor"]);
/** `p: { xs: 1, md: 2 }`처럼 브레이크포인트로 값을 나누는 객체의 키. */
const BREAKPOINTS: ReadonlySet<string> = new Set(["xs", "sm", "md", "lg", "xl"]);

type Classify = NonNullable<StyleObjectContext["classify"]>;

/** 숫자 리터럴 또는 부호 붙은 숫자 리터럴이면 true. */
function isNumeric(value: Parameters<Classify>[1]): boolean {
  return (
    value.type === "NumericLiteral" ||
    (value.type === "UnaryExpression" &&
      (value.operator === "-" || value.operator === "+") &&
      value.argument.type === "NumericLiteral")
  );
}

/** 기본 분류가 만든 usage를 테마 스케일 token으로 바꾼다. 치환 구간이 없으므로 write는 null을 돌려준다. */
function asToken(base: StyleObjectUsage | null, normalized: StyleUsage["normalized"]): StyleObjectUsage | null {
  if (base === null) return null;
  return { usage: { ...base.usage, source: "token", normalized }, patch: null };
}

/**
 * sx 전용 분류. 별칭 키(`p`, `bgcolor` …)는 `defaultClassify(CSS 이름)`으로 기본 규칙에 태워 속성·정규화를 맞추고,
 * 테마 스케일 값(간격·borderRadius 숫자, 팔레트 경로)만 token으로 덮어쓴다. 나머지는 inline-style과 같은 규칙.
 */
const classify: Classify = (key, value, defaultClassify) => {
  const cssName = Object.hasOwn(MUI_KEY_MAP, key) ? MUI_KEY_MAP[key] : undefined;
  const base = (): StyleObjectUsage | null => defaultClassify(cssName);

  if (isNumeric(value)) {
    const scale = isSpacingProp(key) ? "spacing" : key === "borderRadius" ? "radius" : null;
    if (scale !== null) {
      const result = base();
      const n = result?.usage.normalized;
      if (n?.kind !== "length") return result;
      return asToken(result, { kind: "length", px: scale === "spacing" ? spacingToPx(n.px) : spacingToPx(n.px, SHAPE_BORDER_RADIUS_PX) });
    }
  }
  if (SIZE_KEYS.has(key) && isNumeric(value)) {
    const result = base();
    const n = result?.usage.normalized;
    if (result === null || n?.kind !== "length" || n.px <= 0 || n.px > 1) return result;
    // 비율 값은 hardcoded로 두되 px 길이로 세지 않는다.
    return { ...result, usage: { ...result.usage, normalized: { kind: "unknown" } } };
  }
  // `grey`는 팔레트 경로이기 전에 CSS 색 이름이다.
  if (PALETTE_KEYS.has(key) && value.type === "StringLiteral" && isPalettePath(value.value) && normalizeColor(value.value) === null) {
    return asToken(base(), { kind: "unknown" });
  }
  return cssName === undefined ? undefined : base();
};

function breakpointKey(prop: ObjectProperty["key"] | undefined, computed: boolean): string | null {
  if (computed) return null;
  if (prop?.type === "Identifier") return prop.name;
  if (prop?.type === "StringLiteral") return prop.value;
  return null;
}

/** `{ xs: …, md: … }`: 비어 있지 않고 모든 키가 브레이크포인트인 객체. */
function isResponsiveValue(obj: ObjectExpression): boolean {
  return (
    obj.properties.length > 0 &&
    obj.properties.every(
      (p) => p.type === "ObjectProperty" && BREAKPOINTS.has(breakpointKey(p.key, p.computed) ?? ""),
    )
  );
}

/**
 * 반응형 값 객체(`p: { xs: 1, md: 2 }`)를 부모 키를 단 속성 여러 개(`p: 1, p: 2`)로 펼친다. 값 노드는 그대로라 위치·치환 구간이 유지된다.
 * 펼치지 않으면 `xs`·`md`가 CSS 속성처럼 세어진다. 중첩 선택자 객체는 안쪽까지 같은 처리를 한다.
 */
function expandResponsive(obj: ObjectExpression): ObjectExpression {
  const properties: ObjectExpression["properties"] = [];
  for (const prop of obj.properties) {
    if (prop.type !== "ObjectProperty" || prop.value.type !== "ObjectExpression") {
      properties.push(prop);
    } else if (!prop.computed && isResponsiveValue(prop.value)) {
      for (const child of prop.value.properties) {
        if (child.type === "ObjectProperty") properties.push({ ...child, key: prop.key, computed: false });
      }
    } else {
      properties.push({ ...prop, value: expandResponsive(prop.value) });
    }
  }
  return { ...obj, properties };
}

function extract(ctx: ExtractContext): StyleUsage[] {
  // 복구 불가능한 문법 오류는 그대로 던진다. 파일 단위 실패 기록은 호출자(indexer) 몫이다.
  const ast = parseTsx(ctx.code, ctx.file);
  const usages: StyleUsage[] = [];
  const objectCtx: StyleObjectContext = { file: ctx.file, code: ctx.code, extractor: EXTRACTOR_NAME, nested: true, classify };

  const fromObject = (obj: ObjectExpression): void => {
    for (const { usage, patch } of usagesFromStyleObject(expandResponsive(obj), objectCtx)) {
      if (patch !== null) registerPatchTarget(usage, { ...patch, file: ctx.file });
      usages.push(usage);
    }
  };

  const fromSx = (node: Expression): void => {
    switch (node.type) {
      case "ObjectExpression":
        fromObject(node);
        return;
      case "ArrayExpression":
        for (const el of node.elements) if (el !== null && el.type !== "SpreadElement") fromSx(el);
        return;
      case "ConditionalExpression":
        fromSx(node.consequent);
        fromSx(node.alternate);
        return;
      case "LogicalExpression":
        fromSx(node.right);
        return;
      case "TSAsExpression":
      case "TSSatisfiesExpression":
      case "TSNonNullExpression":
      case "ParenthesizedExpression":
        fromSx(node.expression);
        return;
      case "ArrowFunctionExpression":
      case "FunctionExpression":
      // 다른 곳에 정의된 스타일 참조(`styles.root`, `s`, `makeSx()`): 값을 알 수 없지만 커버리지에서 빠지지 않도록 센다.
      case "MemberExpression":
      case "OptionalMemberExpression":
      case "CallExpression":
      case "OptionalCallExpression":
        pushDynamic(node);
        return;
      case "Identifier":
        if (node.name !== "undefined") pushDynamic(node);
        return;
      default:
        return;
    }
  };

  /** 값 전체를 raw로 하는 dynamic `other` usage 한 건. 치환 구간은 없다. */
  const pushDynamic = (node: Expression): void => {
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
      extractor: EXTRACTOR_NAME,
    });
  };

  traverse(ast, {
    JSXAttribute(path) {
      const { name, value } = path.node;
      if (name.type !== "JSXIdentifier" || name.name !== "sx") return;
      if (value?.type !== "JSXExpressionContainer" || value.expression.type === "JSXEmptyExpression") return;
      fromSx(value.expression);
    },
  });
  return usages;
}

export const muiSxExtractor: Extractor = {
  name: EXTRACTOR_NAME,
  files: JS_FILES,
  parses: "tsx",
  // detect 내장 감지는 의존성 ∧ `sx={{`를 요구하지만 signals는 OR이다. 내장 감지가 우선하므로 지금은 결과가 같다.
  signals: { dependencies: ["@mui/material", "@mui/joy"], code: "sx=\\{\\{" },
  appliesTo: (ctx) =>
    JS_FILE.test(ctx.file) && ctx.code.includes("sx=") && (ctx.code.includes("@mui/") || ctx.code.includes("sx={")),
  extract,
  write,
  tokenRef,
};
