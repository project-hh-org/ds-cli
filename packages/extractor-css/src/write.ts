import { cssVarRef } from "@dsmith-dev/extractor-api";
import type { StyleUsage, TokenLike, WritePatch } from "@dsmith-dev/extractor-api";
import { isRatedUsage } from "@dsmith-dev/core";

/** 치환 패치에 필요한 값(또는 축약 안의 색 토큰) 구간. */
interface PatchTarget {
  start: number;
  end: number;
  file: string;
}

const patchTargets = new WeakMap<StyleUsage, PatchTarget>();

/** extract가 hardcoded usage를 만들 때 호출해 치환 구간을 기록한다. */
export function registerPatchTarget(usage: StyleUsage, target: PatchTarget): void {
  patchTargets.set(usage, target);
}

/**
 * 기록해 둔 구간을 `tokenRef` 그대로(따옴표 없이) 치환하는 패치를 만든다.
 * hardcoded가 아니거나 점수 대상이 아니거나(`isRatedUsage` false: other 속성·정규화 안 된 값) 이 추출기가 만들지 않은 usage는 null.
 */
export function write(usage: StyleUsage, tokenRef: string): WritePatch | null {
  if (usage.source !== "hardcoded" || !isRatedUsage(usage)) return null;
  const target = patchTargets.get(usage);
  if (target === undefined) return null;
  return { file: target.file, start: target.start, end: target.end, replacement: tokenRef };
}

/** CSS 값 자리에는 CSS 변수 참조(`var(--x)`)를 그대로 쓴다. 변수가 아닌 이름의 토큰은 참조 형식이 없다. */
export function tokenRef(token: TokenLike): string | null {
  return cssVarRef(token);
}
