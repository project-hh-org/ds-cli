import { normalizeColor, normalizeLength, parseTsx, traverse } from "@dsmith/core";
import type {
  ExtractContext,
  Extractor,
  StyleProperty,
  StyleSource,
  StyleUsage,
} from "@dsmith/extractor-api";
import type { Node } from "@babel/types";
import { parseClassToken, type ParsedClass } from "./class-parser.js";
import { defaultTheme } from "./default-theme.js";
import { registerPatchTarget, write } from "./write.js";

export const EXTRACTOR_NAME = "tailwind";

type Normalized = StyleUsage["normalized"];
const UNKNOWN: Normalized = { kind: "unknown" };

/** 유틸리티가 어떤 CSS 속성으로 매핑되는지. `text`는 값에 따라 color/font-size로 갈린다. */
type Rule =
  | { kind: "color"; property: StyleProperty }
  | { kind: "length"; property: StyleProperty; scale: "spacing" | "radius" }
  | { kind: "text" };

export const RULES = new Map<string, Rule>();

function addRule(names: readonly string[], rule: Rule): void {
  for (const name of names) RULES.set(name, rule);
}

addRule(["text"], { kind: "text" });
addRule(["bg"], { kind: "color", property: "background-color" });
addRule(["fill"], { kind: "color", property: "fill" });
addRule(["stroke"], { kind: "color", property: "stroke" });
addRule(
  [
    "border", "border-x", "border-y", "border-s", "border-e",
    "border-t", "border-r", "border-b", "border-l",
    "ring", "outline",
  ],
  { kind: "color", property: "border-color" },
);
addRule(["p", "px", "py", "pt", "pr", "pb", "pl"], { kind: "length", property: "padding", scale: "spacing" });
addRule(["m", "mx", "my", "mt", "mr", "mb", "ml"], { kind: "length", property: "margin", scale: "spacing" });
addRule(["gap", "gap-x", "gap-y"], { kind: "length", property: "gap", scale: "spacing" });
addRule(["w", "min-w", "max-w"], { kind: "length", property: "width", scale: "spacing" });
addRule(["h", "min-h", "max-h"], { kind: "length", property: "height", scale: "spacing" });
addRule(
  [
    "rounded", "rounded-s", "rounded-e", "rounded-t", "rounded-r", "rounded-b", "rounded-l",
    "rounded-ss", "rounded-se", "rounded-ee", "rounded-es",
    "rounded-tl", "rounded-tr", "rounded-br", "rounded-bl",
  ],
  { kind: "length", property: "border-radius", scale: "radius" },
);

/** 색 유틸리티 접두를 공유하지만 색이 아닌 값의 첫 구간(폭, 스타일, 정렬, 배경 배치 등). */
const NON_COLOR_VALUES: ReadonlySet<string> = new Set([
  "current", "transparent", "inherit", "none", "inset", "offset", "opacity", "solid", "dashed", "dotted",
  "double", "hidden", "collapse", "separate", "spacing", "left", "right", "center", "justify", "start",
  "end", "wrap", "nowrap", "balance", "pretty", "ellipsis", "clip", "fixed", "local", "scroll", "repeat",
  "no", "cover", "contain", "auto", "top", "bottom", "gradient", "blend", "origin",
]);

/** 길이 유틸리티 접두를 공유하지만 테마 키가 아닌 값의 첫 구간(키워드). */
const NON_LENGTH_VALUES: ReadonlySet<string> = new Set([
  "full", "auto", "screen", "svw", "lvw", "dvw", "svh", "lvh", "dvh", "min", "max", "fit", "none", "prose",
]);

/** `max-w-2xl`, `min-w-md` 같은 컨테이너 크기 이름. 다른 길이 유틸리티의 `p-md`는 커스텀 토큰이다. */
const CONTAINER_SIZE_NAMES: ReadonlySet<string> = new Set([
  "xs", "sm", "md", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl",
]);
const CONTAINER_SIZE_UTILITIES: ReadonlySet<string> = new Set(["max-w", "min-w"]);

/** 프로토타입 체인(`constructor`, `toString` 등)을 타지 않는 테마 조회. */
function lookup<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

const COLOR_NAME = /^[a-z][\w-]*$/i;
const LENGTH_NAME = /^[a-z0-9][\w.-]*$/i;
/** 색·길이가 아닌 arbitrary 값(이미지, 그라디언트, 타입 힌트). */
const NON_STYLE_ARBITRARY = /^(?:url\(|[a-z-]*gradient\(|(?:image|percentage|position|size|number|family):)/i;
const TYPE_HINT = /^(color|length):(.*)$/s;
/** `var(--…)` 값은 CSS 변수(토큰) 참조다. */
const CSS_VAR_REF = /^\s*var\(\s*--/;

interface Resolved {
  property: StyleProperty;
  normalized: Normalized;
  source: StyleSource;
}

function negate(px: number): number {
  return px === 0 ? 0 : -px;
}

function colorOf(hex: string): Normalized {
  return normalizeColor(hex) ?? UNKNOWN;
}

function resolveArbitrary(c: ParsedClass, rule: Rule): Resolved | null {
  let value = c.value ?? "";
  let hint: string | null = null;
  const hinted = TYPE_HINT.exec(value);
  if (hinted !== null) {
    hint = hinted[1] ?? null;
    value = hinted[2] ?? "";
  }
  if (NON_STYLE_ARBITRARY.test(value)) return null;

  // `bg-[var(--brand)]`: CSS 변수(토큰) 참조. property는 매핑된 것을 유지하고, `text-`는 힌트가 없으면 알 수 없다.
  if (CSS_VAR_REF.test(value)) {
    const token = (property: StyleProperty): Resolved => ({ property, normalized: UNKNOWN, source: "token" });
    switch (rule.kind) {
      case "length":
        return hint === "color" ? null : token(rule.property);
      case "color":
        return hint === "length" ? null : token(rule.property);
      case "text":
        return token(hint === "color" ? "color" : hint === "length" ? "font-size" : "other");
    }
  }

  const asColor = (property: StyleProperty): Resolved => ({
    property,
    normalized: normalizeColor(value) ?? UNKNOWN,
    source: "hardcoded",
  });
  const asLength = (property: StyleProperty): Resolved => {
    const px = normalizeLength(value);
    return {
      property,
      normalized: px === null ? UNKNOWN : { kind: "length", px: c.negative ? negate(px) : px },
      source: "hardcoded",
    };
  };

  switch (rule.kind) {
    case "length":
      return hint === "color" ? null : asLength(rule.property);
    case "color":
      if (hint === "length") return null;
      // border-[3px], ring-[2px] 같은 폭 값은 색이 아니다.
      if (hint !== "color" && normalizeColor(value) === null && normalizeLength(value) !== null) return null;
      return asColor(rule.property);
    case "text":
      if (hint === "color") return asColor("color");
      if (hint === "length") return asLength("font-size");
      if (normalizeColor(value) !== null) return asColor("color");
      if (normalizeLength(value) !== null) return asLength("font-size");
      return { property: "other", normalized: UNKNOWN, source: "hardcoded" };
  }
}

function resolveNamed(c: ParsedClass, rule: Rule): Resolved | null {
  const value = c.value;

  if (rule.kind === "length") {
    const scale = rule.scale === "radius" ? defaultTheme.borderRadius : defaultTheme.spacing;
    // 접미사 없는 `rounded`만 DEFAULT 값을 가진다.
    const key = value ?? (rule.scale === "radius" ? "DEFAULT" : null);
    if (key === null) return null;
    const px = lookup(scale, key);
    if (px !== undefined) {
      const signed = c.negative ? negate(px) : px;
      return { property: rule.property, normalized: { kind: "length", px: signed }, source: "tailwind-default" };
    }
    if (value === null || !LENGTH_NAME.test(value)) return null;
    const head = value.split("-")[0] ?? "";
    if (NON_LENGTH_VALUES.has(head)) return null;
    if (CONTAINER_SIZE_UTILITIES.has(c.utility) && CONTAINER_SIZE_NAMES.has(head)) return null;
    return { property: rule.property, normalized: UNKNOWN, source: "token" };
  }

  if (value === null) return null;
  const hex = lookup(defaultTheme.colors, value);
  const colorProperty: StyleProperty = rule.kind === "text" ? "color" : rule.property;
  if (hex !== undefined) {
    return { property: colorProperty, normalized: colorOf(hex), source: "tailwind-default" };
  }
  const fontSize = rule.kind === "text" ? lookup(defaultTheme.fontSize, value) : undefined;
  if (fontSize !== undefined) {
    return { property: "font-size", normalized: { kind: "length", px: fontSize }, source: "tailwind-default" };
  }
  // 숫자로 시작하면 폭(`border-2`, `ring-2`), 알려진 키워드면 색이 아니다. 나머지는 프로젝트 테마의 이름 있는 색으로 본다.
  if (!COLOR_NAME.test(value) || NON_COLOR_VALUES.has(value.split("-")[0] ?? "")) return null;
  return { property: colorProperty, normalized: UNKNOWN, source: "token" };
}

/** 클래스 하나를 usage 정보로 해석한다. 매핑 대상이 아니면 null. */
function resolveClass(c: ParsedClass): Resolved | null {
  const rule = RULES.get(c.utility);
  if (rule === undefined) return null;
  // `bg-blue-500/50`, `w-1/2` 같은 슬래시 수식어·분수는 모델링하지 않는다.
  if (c.value?.includes("/") === true && !c.arbitrary) return null;
  if (c.arbitrary) return resolveArbitrary(c, rule);
  return resolveNamed(c, rule);
}

class Collector {
  readonly usages: StyleUsage[] = [];
  private readonly lineStarts: number[] = [0];

  constructor(private readonly ctx: ExtractContext) {
    for (let i = 0; i < ctx.code.length; i++) {
      if (ctx.code[i] === "\n") this.lineStarts.push(i + 1);
    }
  }

  private position(offset: number): { line: number; column: number } {
    let lo = 0;
    let hi = this.lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.lineStarts[mid] ?? 0) <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, column: offset - (this.lineStarts[lo] ?? 0) };
  }

  /** 소스 구간 `[start, end)`의 텍스트(따옴표·백틱 제외)를 클래스 토큰으로 나눠 usage를 만든다. */
  private scanText(start: number, end: number, partialStart: boolean, partialEnd: boolean): void {
    const text = this.ctx.code.slice(start, end);
    for (const match of text.matchAll(/\S+/g)) {
      const token = match[0];
      const index = match.index ?? 0;
      // `p-${n}`의 `p-`처럼 ${}에 맞닿은 조각은 완전한 토큰이 아니다. 해당 ${}가 dynamic으로 집계된다.
      if (partialStart && index === 0) continue;
      if (partialEnd && index + token.length === text.length) continue;

      const parsed = parseClassToken(token);
      const resolved = resolveClass(parsed);
      if (resolved === null) continue;

      const offset = start + index;
      const usage: StyleUsage = {
        file: this.ctx.file,
        ...this.position(offset),
        property: resolved.property,
        raw: token,
        normalized: resolved.normalized,
        source: resolved.source,
        extractor: EXTRACTOR_NAME,
      };
      registerPatchTarget(usage, {
        file: this.ctx.file,
        start: offset,
        end: offset + token.length,
        variants: parsed.variants,
        important: parsed.important,
      });
      this.usages.push(usage);
    }
  }

  private dynamic(node: Node): void {
    const { start, end } = node;
    if (start == null || end == null) return;
    this.usages.push({
      file: this.ctx.file,
      ...this.position(start),
      property: "other",
      raw: this.ctx.code.slice(start, end),
      normalized: UNKNOWN,
      source: "dynamic",
      extractor: EXTRACTOR_NAME,
    });
  }

  /** className 값 표현식을 재귀적으로 훑는다. 리터럴이 아닌 표현식은 dynamic 한 건으로 센다. */
  visit(node: Node | null | undefined): void {
    if (node == null) return;
    switch (node.type) {
      case "StringLiteral":
        if (node.start != null && node.end != null) this.scanText(node.start + 1, node.end - 1, false, false);
        return;
      case "TemplateLiteral": {
        const last = node.quasis.length - 1;
        node.quasis.forEach((quasi, i) => {
          if (quasi.start != null && quasi.end != null) this.scanText(quasi.start, quasi.end, i > 0, i < last);
        });
        for (const expression of node.expressions) this.visit(expression);
        return;
      }
      case "CallExpression":
        for (const arg of node.arguments) this.visit(arg);
        return;
      case "ArrayExpression":
        for (const element of node.elements) this.visit(element);
        return;
      case "ConditionalExpression":
        this.visit(node.consequent);
        this.visit(node.alternate);
        return;
      case "LogicalExpression":
        // `cond && "x"`의 왼쪽은 조건이지 클래스 값이 아니다.
        if (node.operator !== "&&") this.visit(node.left);
        this.visit(node.right);
        return;
      case "Identifier":
        if (node.name === "undefined") return;
        this.dynamic(node);
        return;
      case "UnaryExpression":
        // `void 0`
        if (node.operator === "void" && node.argument.type === "NumericLiteral") return;
        this.dynamic(node);
        return;
      case "JSXEmptyExpression":
      case "NumericLiteral":
      case "BooleanLiteral":
      case "NullLiteral":
        return;
      default:
        this.dynamic(node);
    }
  }
}

function extract(ctx: ExtractContext): StyleUsage[] {
  // 복구 불가능한 문법 오류는 그대로 던진다. 파일 단위 실패 기록은 호출자(indexer) 몫이다.
  const ast = parseTsx(ctx.code, ctx.file);
  const collector = new Collector(ctx);

  traverse(ast, {
    JSXAttribute(path) {
      const { name, value } = path.node;
      if (name.type !== "JSXIdentifier" || (name.name !== "className" && name.name !== "class")) return;
      if (value?.type === "StringLiteral") collector.visit(value);
      else if (value?.type === "JSXExpressionContainer") collector.visit(value.expression);
    },
  });
  return collector.usages;
}

export const tailwindExtractor: Extractor = {
  name: EXTRACTOR_NAME,
  appliesTo: (ctx) => /\.[cm]?[jt]sx?$/.test(ctx.file) && ctx.code.includes("className"),
  extract,
  write,
};
