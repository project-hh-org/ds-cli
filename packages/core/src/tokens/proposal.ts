import type { StyleUsage } from "@dsmith-dev/extractor-api";
import { clusterColors } from "../cluster/color-cluster.js";
import { clusterSpacing } from "../cluster/spacing-cluster.js";
import type { Token } from "../model/token.js";

const SCALE_UNIT_PX = 4;

/**
 * 토큰 파일이 없는 레포용 제안 토큰. audit 보고서와 같은 클러스터링 결과를 쓴다.
 * 색은 클러스터 대표값(이름 중복은 -2, -3 …), 간격은 4px 스케일 위의 값만 `space-N`.
 */
export function proposalTokens(styles: StyleUsage[]): Token[] {
  const tokens: Token[] = [];

  const used = new Set<string>();
  for (const cluster of clusterColors(styles)) {
    let name = cluster.suggestedName;
    for (let n = 2; used.has(name); n++) name = `${cluster.suggestedName}-${n}`;
    used.add(name);
    tokens.push({
      name,
      value: cluster.representative.hex,
      normalized: cluster.representative,
      category: "color",
    });
  }

  for (const candidate of clusterSpacing(styles)) {
    // 음수(역방향 margin)는 토큰이 될 수 없다.
    if (!candidate.onScale || candidate.px < 0) continue;
    tokens.push({
      name: `space-${candidate.px / SCALE_UNIT_PX}`,
      value: `${candidate.px}px`,
      normalized: { kind: "length", px: candidate.px },
      category: "spacing",
    });
  }

  return tokens;
}
