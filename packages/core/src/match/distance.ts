import type { NormalizedColor } from "../model/style-usage.js";

function toCartesian(color: NormalizedColor): { l: number; a: number; b: number } {
  const radians = (color.h * Math.PI) / 180;
  return { l: color.l, a: color.c * Math.cos(radians), b: color.c * Math.sin(radians) };
}

/** oklch 색 사이의 ΔE_ok (hue를 직교 좌표로 변환한 유클리드 거리) */
export function colorDistance(a: NormalizedColor, b: NormalizedColor): number {
  const p = toCartesian(a);
  const q = toCartesian(b);
  return Math.sqrt((p.l - q.l) ** 2 + (p.a - q.a) ** 2 + (p.b - q.b) ** 2);
}

/** px 단위 길이 차이 */
export function lengthDistance(a: number, b: number): number {
  return Math.abs(a - b);
}
