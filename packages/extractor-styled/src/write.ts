import { cssVarRef } from "@dsmith-dev/extractor-api";
import type { StyleUsage, TokenLike, WritePatch } from "@dsmith-dev/extractor-api";
import { isRatedUsage } from "@dsmith-dev/core";

/** 치환할 소스 구간. `quote`면 객체 문법의 숫자 리터럴 노드 자리라 `tokenRef`를 따옴표로 감싼다(문자열 값은 따옴표 안 하위 구간이라 false). */
export interface PatchTarget {
  file: string;
  start: number;
  end: number;
  quote: boolean;
}

const patchTargets = new WeakMap<StyleUsage, PatchTarget>();

/** extract가 리터럴 값 usage를 만들 때 호출해 치환 구간을 기록한다. */
export function registerPatchTarget(usage: StyleUsage, target: PatchTarget): void {
  patchTargets.set(usage, target);
}

/**
 * 기록해 둔 구간을 치환하는 패치를 만든다. 템플릿 값·객체 문법 문자열 값은 `tokenRef` 그대로, 객체 문법 숫자 값은 `JSON.stringify(tokenRef)`.
 * hardcoded가 아니거나 점수 대상이 아니거나(`isRatedUsage` false: other 속성·정규화 안 된 값) 이 패키지가 만들지 않은 usage는 null.
 */
export function write(usage: StyleUsage, tokenRef: string): WritePatch | null {
  if (usage.source !== "hardcoded" || !isRatedUsage(usage)) return null;
  const target = patchTargets.get(usage);
  if (target === undefined) return null;
  return {
    file: target.file,
    start: target.start,
    end: target.end,
    replacement: target.quote ? JSON.stringify(tokenRef) : tokenRef,
  };
}

/** 값 자리에는 CSS 변수 참조(`var(--x)`)를 쓴다(숫자 노드는 write가 문자열로 감싼다). 변수가 아닌 이름의 토큰은 참조 형식이 없다. */
export function tokenRef(token: TokenLike): string | null {
  return cssVarRef(token);
}
