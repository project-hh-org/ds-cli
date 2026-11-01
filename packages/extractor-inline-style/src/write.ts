import type { StyleUsage, WritePatch } from "@dsmith-dev/extractor-api";
import { isRatedUsage } from "@dsmith-dev/core";

/** 치환 패치에 필요한 소스 구간. `quote`면 숫자 리터럴 노드 자리라 `tokenRef`를 문자열 리터럴로 감싼다. */
interface PatchTarget {
  start: number;
  end: number;
  file: string;
  quote: boolean;
}

const patchTargets = new WeakMap<StyleUsage, PatchTarget>();

/** extract가 리터럴 값 usage를 만들 때 호출해 치환 구간을 기록한다. */
export function registerPatchTarget(usage: StyleUsage, target: PatchTarget): void {
  patchTargets.set(usage, target);
}

/**
 * 기록해 둔 구간을 치환하는 패치를 만든다. 문자열 값은 따옴표 안 구간에 `tokenRef` 그대로,
 * 숫자 값은 노드 전체를 `"<tokenRef>"` 문자열로 바꾼다.
 * hardcoded가 아니거나 점수 대상이 아니거나(`isRatedUsage` false: other 속성·정규화 안 된 값) 이 추출기가 만들지 않은 usage는 null.
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
