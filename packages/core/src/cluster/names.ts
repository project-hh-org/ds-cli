import type { ColorCluster } from "./color-cluster.js";

/**
 * 첫 등장은 그대로, 같은 이름이 다시 나오면 -2, -3 …(이미 쓰인 이름은 건너뜀). 입력 순서를 유지한다.
 */
export function uniqueNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((base) => {
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base}-${n}`;
    used.add(name);
    return name;
  });
}

/** proposalTokens·audit 리포트·토큰 초안이 같은 색 이름을 쓰도록 모은 규칙. */
export function colorTokenNames(clusters: ColorCluster[]): string[] {
  return uniqueNames(clusters.map((c) => c.suggestedName));
}
