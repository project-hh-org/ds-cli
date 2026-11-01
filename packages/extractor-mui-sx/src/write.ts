import { cssVarRef } from "@dsmith-dev/extractor-api";
import type { StyleProperty, StyleUsage, TokenLike, WritePatch } from "@dsmith-dev/extractor-api";
import { isRatedUsage } from "@dsmith-dev/core";
import { SPACING_UNIT_PX } from "./theme-scale.js";

/** 치환할 소스 구간. 문자열 값은 따옴표 안 하위 구간(`quote: false`), 숫자 값은 노드 전체(`quote: true`). */
export interface PatchTarget {
  file: string;
  start: number;
  end: number;
  quote: boolean;
  /** 값이 문자열 리터럴이고 구간이 따옴표 안 내용 전체일 때, 따옴표를 포함한 노드 전체 구간(숫자 스케일 치환용) */
  literal?: { start: number; end: number };
}

const patchTargets = new WeakMap<StyleUsage, PatchTarget>();

/** extract가 리터럴 값 usage를 만들 때 호출해 치환 구간을 기록한다. */
export function registerPatchTarget(usage: StyleUsage, target: PatchTarget): void {
  patchTargets.set(usage, target);
}

const SPACING_PROPERTIES: ReadonlySet<StyleProperty> = new Set(["padding", "margin", "gap"]);
const NUMERIC_SCALE =/^\d+(\.\d+)?$/;

/**
 * 기록해 둔 구간을 치환하는 패치를 만든다. 문자열 값은 따옴표 안 구간에 `tokenRef` 그대로,
 * 숫자 값(`fontSize: 13`)은 노드 전체를 문자열 CSS 값(`"var(--fs)"`)으로 바꾼다.
 * `tokenRef`가 숫자 스케일(`"2"`)이면 문자열 리터럴 노드 전체(따옴표 포함)를 숫자로 바꾼다(`p: "16px"` → `p: 2`). 리터럴 구간이 없으면 null.
 * hardcoded가 아니거나(테마 스케일 token·dynamic) 점수 대상이 아니거나(`isRatedUsage` false) 이 추출기가 만들지 않은 usage는 null.
 */
export function write(usage: StyleUsage, tokenRef: string): WritePatch | null {
  if (usage.source !== "hardcoded" || !isRatedUsage(usage)) return null;
  const target = patchTargets.get(usage);
  if (target === undefined) return null;
  if (NUMERIC_SCALE.test(tokenRef)) {
    if (target.literal === undefined) return null;
    return { file: target.file, start: target.literal.start, end: target.literal.end, replacement: tokenRef };
  }
  const replacement = target.quote ? JSON.stringify(tokenRef) : tokenRef;
  return { file: target.file, start: target.start, end: target.end, replacement };
}

/**
 * 색·모서리·글꼴 크기는 CSS 변수 참조. 간격은 토큰 값이 usage 값과 정확히 같고 8px의 양의 배수이며 문자열 리터럴 전체를 바꿀 수 있으면
 * 테마 숫자 스케일(`16px` → `"2"`), 아니면 CSS 변수 참조. 스케일은 MUI 기본 `theme.spacing`(8px)을 가정한다.
 */
export function tokenRef(token: TokenLike, usage: StyleUsage): string | null {
  // 숫자 스케일은 padding·margin·gap 키에서만 `theme.spacing()`이 된다. width 등에서 `2`는 200%라 쓸 수 없다.
  if (token.category === "spacing" && !SPACING_PROPERTIES.has(usage.property)) return null;
  if (
    token.category === "spacing" &&
    token.normalized.kind === "length" &&
    usage.normalized.kind === "length" &&
    usage.normalized.px === token.normalized.px &&
    usage.normalized.px > 0 &&
    usage.normalized.px % SPACING_UNIT_PX === 0 &&
    patchTargets.get(usage)?.literal !== undefined
  ) {
    return String(usage.normalized.px / SPACING_UNIT_PX);
  }
  return cssVarRef(token);
}
