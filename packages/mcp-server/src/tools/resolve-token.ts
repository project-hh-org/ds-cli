import {
  cssPropertyToStyleProperty,
  normalizeColor,
  normalizeLength,
  rankTokens,
  tokenCategoryOf,
  type StyleProperty,
  type StyleUsage,
  type TokenSourceKind,
} from "@dsmith-dev/core";
import { tokenSourceKind, type Workspace } from "../workspace.js";

export interface ResolveTokenInput {
  raw: string;
  property?: string | undefined;
}

export interface ResolveTokenOutput {
  input: { raw: string; property?: string };
  token?: { name: string; value: string };
  /** 소수 4자리. 토큰이 없으면 null */
  distance: number | null;
  confidence: "high" | "medium" | "low";
  source: TokenSourceKind;
  alternatives: { name: string; value: string; distance: number }[];
  /** 3a가 읽지 않는 형식이라 건너뛴 토큰 파일 */
  ignoredTokenFiles?: string[];
}

const ALTERNATIVES = 3;
const CONFIDENCE = { exact: "high", close: "medium", far: "low" } as const;

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

/**
 * 이미 정규화한 값에 가장 가까운 토큰. property(kebab/camel)가 있으면 그 속성의 카테고리 토큰만 후보다.
 * lint_snippet은 Extractor가 정규화한 값을 그대로 넘긴다 — Tailwind의 `raw`는 `text-[#3B82F6]`처럼 클래스 전체라 다시 해석할 수 없다.
 */
export function resolveNormalized(
  ws: Workspace,
  normalized: StyleUsage["normalized"],
  input: ResolveTokenInput,
): ResolveTokenOutput {
  const property: StyleProperty | undefined = input.property === undefined ? undefined : cssPropertyToStyleProperty(input.property);
  const category = property === undefined ? null : tokenCategoryOf(property);
  const ranked = rankTokens(normalized, ws.tokens.tokens, {
    ...(category === null ? {} : { category }),
    limit: ALTERNATIVES + 1,
  });

  const sourceByName = new Map(ws.tokens.tokens.map((t) => [t.name, t.source]));
  const [best, ...rest] = ranked;
  const out: ResolveTokenOutput = {
    input: input.property === undefined ? { raw: input.raw } : { raw: input.raw, property: input.property },
    ...(best === undefined ? {} : { token: { name: best.token.name, value: best.token.value } }),
    distance: best === undefined ? null : round4(best.distance),
    confidence: best === undefined ? "low" : CONFIDENCE[best.confidence],
    source: best === undefined ? tokenSourceKind(ws.tokens) : (sourceByName.get(best.token.name) ?? "token-file"),
    alternatives: rest.map((r) => ({ name: r.token.name, value: r.token.value, distance: round4(r.distance) })),
  };
  if (ws.tokens.ignored.length > 0) out.ignoredTokenFiles = ws.tokens.ignored;
  return out;
}

/** raw 값(색 또는 길이)에 가장 가까운 토큰. 해석할 수 없는 값이면 throw. */
export function resolveToken(ws: Workspace, input: ResolveTokenInput): ResolveTokenOutput {
  const raw = input.raw.trim();
  const color = normalizeColor(raw);
  const px = color === null ? normalizeLength(raw) : null;
  if (color === null && px === null) throw new Error(`값을 해석할 수 없음: ${input.raw}`);
  return resolveNormalized(ws, color ?? { kind: "length", px: px ?? 0 }, input);
}
