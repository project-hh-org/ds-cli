import type { StyleUsage } from "@dsmith-dev/extractor-api";
import type { Token } from "../model/token.js";
import { colorDistance, lengthDistance } from "./distance.js";

/**
 * - `distance`: 색은 oklch ΔE_ok(hue를 직교 좌표로 바꾼 유클리드 거리, 실사용 범위 약 0~0.4), 길이는 px 차이.
 * - `confidence`: 색은 거리 < 0.005 exact, < 0.03 close, 그 이상 far.
 *   길이는 0px exact, 2px 이하 close, 그보다 크면 far.
 */
export interface TokenMatch {
  token: Token;
  distance: number;
  confidence: "exact" | "close" | "far";
}

export type RankedToken = TokenMatch;

const COLOR_EXACT = 0.005;
const COLOR_CLOSE = 0.03;
const LENGTH_CLOSE_PX = 2;
const DEFAULT_LIMIT = 4;

/**
 * 거리 오름차순 후보 목록. 거리가 같으면 입력 순서상 앞선 토큰이 먼저다.
 * 색은 색 토큰만, 길이는 color 외 모든 카테고리의 길이 토큰과 비교한다. `category`를 주면 그 카테고리 토큰만 후보다.
 */
export function rankTokens(
  normalized: StyleUsage["normalized"],
  tokens: Token[],
  opts: { category?: Token["category"]; limit?: number } = {},
): RankedToken[] {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const pool = opts.category === undefined ? tokens : tokens.filter((t) => t.category === opts.category);
  const ranked: RankedToken[] = [];

  if (normalized.kind === "color") {
    for (const token of pool) {
      if (token.category !== "color" || token.normalized.kind !== "color") continue;
      const distance = colorDistance(normalized, token.normalized);
      const confidence =
        distance < COLOR_EXACT ? "exact" : distance < COLOR_CLOSE ? "close" : "far";
      ranked.push({ token, distance, confidence });
    }
  } else if (normalized.kind === "length") {
    for (const token of pool) {
      if (token.category === "color" || token.normalized.kind !== "length") continue;
      const distance = lengthDistance(normalized.px, token.normalized.px);
      const confidence =
        distance === 0 ? "exact" : distance <= LENGTH_CLOSE_PX ? "close" : "far";
      ranked.push({ token, distance, confidence });
    }
  } else {
    return [];
  }

  // Array.prototype.sort는 안정 정렬이라 같은 거리는 입력 순서를 유지한다.
  return ranked.sort((a, b) => a.distance - b.distance).slice(0, Math.max(0, limit));
}

/** 가장 가까운 토큰 하나. 필요하면 호출 측에서 카테고리별로 tokens를 미리 거른다. */
export function matchToken(
  normalized: StyleUsage["normalized"],
  tokens: Token[],
): TokenMatch | null {
  return rankTokens(normalized, tokens, { limit: 1 })[0] ?? null;
}
