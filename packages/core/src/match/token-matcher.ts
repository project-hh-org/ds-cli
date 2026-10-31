import type { StyleUsage } from "@dsmith/extractor-api";
import type { Token } from "../model/token.js";
import { colorDistance, lengthDistance } from "./distance.js";

export interface TokenMatch {
  token: Token;
  distance: number;
  confidence: "exact" | "close" | "far";
}

const COLOR_EXACT = 0.005;
const COLOR_CLOSE = 0.03;
const LENGTH_CLOSE_PX = 2;

function pickNearest(
  candidates: { token: Token; distance: number }[],
): { token: Token; distance: number } | null {
  let best: { token: Token; distance: number } | null = null;
  for (const candidate of candidates) {
    if (best === null || candidate.distance < best.distance) best = candidate;
  }
  return best;
}

/** 거리가 같으면 입력 순서상 앞선 토큰이 선택되며, 필요하면 호출 측에서 카테고리별로 tokens를 미리 거른다. */
export function matchToken(
  normalized: StyleUsage["normalized"],
  tokens: Token[],
): TokenMatch | null {
  if (normalized.kind === "color") {
    const candidates: { token: Token; distance: number }[] = [];
    for (const token of tokens) {
      if (token.category !== "color" || token.normalized.kind !== "color") continue;
      candidates.push({ token, distance: colorDistance(normalized, token.normalized) });
    }
    const best = pickNearest(candidates);
    if (best === null) return null;
    const confidence =
      best.distance < COLOR_EXACT ? "exact" : best.distance < COLOR_CLOSE ? "close" : "far";
    return { ...best, confidence };
  }

  if (normalized.kind === "length") {
    const candidates: { token: Token; distance: number }[] = [];
    for (const token of tokens) {
      if (token.category === "color" || token.normalized.kind !== "length") continue;
      candidates.push({ token, distance: lengthDistance(normalized.px, token.normalized.px) });
    }
    const best = pickNearest(candidates);
    if (best === null) return null;
    const confidence =
      best.distance === 0 ? "exact" : best.distance <= LENGTH_CLOSE_PX ? "close" : "far";
    return { ...best, confidence };
  }

  return null;
}
