import { TAILWIND_PRESET_PREFIX, cssVarRef } from "@dsmith-dev/extractor-api";
import type { StyleProperty, StyleUsage, TokenLike, TokenRefContext, WritePatch } from "@dsmith-dev/extractor-api";
import { isRatedUsage } from "@dsmith-dev/core";

/**
 * 프리셋 글꼴 크기 키(`ds-2xs`, `ds-xs`, `ds-2xl`, 충돌 접미 `ds-sm-2`). 프리셋이 `fontSize`에 평탄 키로 넣는 이름이다.
 * 코어 글꼴 사다리(2xs…)와 같은 범위여야 하며, extract가 `text-ds-*`를 글꼴 크기로 읽는 기준이기도 하다.
 */
export const PRESET_FONT_SIZE_KEY = new RegExp(`^${TAILWIND_PRESET_PREFIX}-(?:[2-9]?xs|sm|base|lg|xl|[2-9]xl)(-\\d+)?$`);

/** 치환할 클래스 토큰의 소스 구간(variant 접두 포함)과 보존할 variant 목록. */
interface PatchTarget {
  start: number;
  end: number;
  file: string;
  variants: readonly string[];
  important: "prefix" | "suffix" | null;
  /** 유틸리티 이름(`bg`, `p`, `rounded-t` …) — 토큰 참조 클래스를 만들 때 쓴다 */
  utility: string;
  /** `-mt-2`처럼 음수 접두가 있었는가 */
  negative: boolean;
}

const patchTargets = new WeakMap<StyleUsage, PatchTarget>();

/** extract가 클래스 토큰 usage를 만들 때 호출해 치환 구간을 기록한다. */
export function registerPatchTarget(usage: StyleUsage, target: PatchTarget): void {
  patchTargets.set(usage, target);
}

/**
 * 기록해 둔 클래스 토큰 하나를 `[variants:]tokenRef`로 치환하는 패치를 만든다.
 * variant 접두(`md:`, `hover:` 등)와 important `!`는 보존한다. `-mt-2`처럼 음수 접두가 있었다면 `tokenRef`가 그 의미를 담아야 한다.
 * dynamic·token 소스이거나 점수 대상이 아니거나(`isRatedUsage` false: other 속성·정규화 안 된 값) 이 추출기가 만들지 않은 usage는 null.
 */
export function write(usage: StyleUsage, tokenRef: string): WritePatch | null {
  if (usage.source === "dynamic" || usage.source === "token" || !isRatedUsage(usage)) return null;
  const target = patchTargets.get(usage);
  if (target === undefined) return null;
  // tokenRef가 곧 유틸리티 전체다. `-mt-2` 같은 음수 부호는 호출자가 tokenRef에 담는다.
  const body = target.important === "prefix" ? `!${tokenRef}` : tokenRef;
  const important = target.important === "suffix" ? "!" : "";
  const replacement = [...target.variants, `${body}${important}`].join(":");
  return { file: target.file, start: target.start, end: target.end, replacement };
}

const COLOR_PROPERTIES: ReadonlySet<StyleProperty> = new Set(["color", "background-color", "border-color", "fill", "stroke"]);
const SPACING_PROPERTIES: ReadonlySet<StyleProperty> = new Set(["padding", "margin", "gap"]);

/**
 * 토큰을 참조하는 유틸리티 클래스(variant·`!`는 write가 붙인다). 프리셋 키가 있으면 클래스명(`bg-ds-blue-400`),
 * 없으면 타입 힌트가 붙은 임의값(`bg-[color:var(--color-blue-400)]`, `text-[length:var(--text-xs)]`).
 * CSS 변수가 아닌 토큰, 토큰 대상이 아닌 속성(width·height), 토큰 분류와 속성이 안 맞는 경우는 null.
 */
export function tokenRef(token: TokenLike, usage: StyleUsage, ctx: TokenRefContext): string | null {
  const target = patchTargets.get(usage);
  if (target === undefined) return null;
  const variable = cssVarRef(token);
  if (variable === null) return null;
  const key = ctx.preset?.keys[token.name];
  const neg = target.negative ? "-" : "";
  const { utility } = target;
  switch (token.category) {
    case "color":
      if (!COLOR_PROPERTIES.has(usage.property)) return null;
      return key !== undefined ? `${utility}-${key}` : `${utility}-[color:${variable}]`;
    case "spacing":
      if (!SPACING_PROPERTIES.has(usage.property)) return null;
      return key !== undefined ? `${neg}${utility}-${key}` : `${neg}${utility}-[${variable}]`;
    case "radius":
      if (usage.property !== "border-radius") return null;
      return key !== undefined ? `${utility}-${key}` : `${utility}-[${variable}]`;
    case "font-size":
      if (usage.property !== "font-size") return null;
      // 키가 글꼴 크기 키 모양이 아니면 `text-ds-<이름>`이 색으로 읽히므로 임의값으로 쓴다.
      return key !== undefined && PRESET_FONT_SIZE_KEY.test(key) ? `text-${key}` : `text-[length:${variable}]`;
  }
}
