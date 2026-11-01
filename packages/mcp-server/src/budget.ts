/** 도구 응답 하나의 추정 토큰 상한 기본값. 목록형은 커서로, 객체형은 축약으로 지킨다. */
export const DEFAULT_TOKEN_BUDGET = 1500;

/** ASCII 코드포인트는 0.25, 그 밖은 1로 세어 합을 올린다. 토크나이저 없이 쓰는 보수적 추정이다. */
export function estimateTokens(text: string): number {
  let total = 0;
  for (const ch of text) total += (ch.codePointAt(0) ?? 0) < 128 ? 0.25 : 1;
  return Math.ceil(total);
}

/** 응답 본문 직렬화(compact JSON). 상한 계산도 이 문자열 기준이다. */
export function toText(value: unknown): string {
  return JSON.stringify(value);
}

export interface Page<T> {
  items: T[];
  /** 커서와 무관한 전체 개수 */
  total: number;
  truncated: boolean;
  nextCursor?: string;
}

function parseCursor(cursor: string | undefined, total: number): number {
  if (cursor === undefined) return 0;
  if (!/^\d+$/.test(cursor)) throw new Error(`잘못된 cursor: ${JSON.stringify(cursor)}`);
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset) || offset > total) throw new Error(`잘못된 cursor: ${JSON.stringify(cursor)}`);
  return offset;
}

/**
 * cursor(시작 오프셋의 10진 문자열)부터 `wrap(page)` 직렬화가 budget 이하인 만큼 탐욕적으로 담는다. 최소 1개는 담는다.
 * 남는 항목이 있으면 truncated true + nextCursor.
 */
export function paginate<T>(
  items: T[],
  cursor: string | undefined,
  budget: number,
  wrap: (page: Page<T>) => object,
): object {
  const total = items.length;
  const start = parseCursor(cursor, total);
  const remaining = total - start;

  const pageOf = (count: number): Page<T> => {
    const end = start + count;
    const page: Page<T> = { items: items.slice(start, end), total, truncated: end < total };
    if (end < total) page.nextCursor = String(end);
    return page;
  };
  const fits = (count: number): boolean => estimateTokens(toText(wrap(pageOf(count)))) <= budget;

  if (remaining <= 1 || fits(remaining)) return wrap(pageOf(remaining));
  // 이분 탐색: lo는 항상 상한 안(또는 최소 1개)이다.
  let lo = 1;
  let hi = remaining - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  return wrap(pageOf(lo));
}

interface ArrayRef {
  path: string;
  parent: Record<string | number, unknown>;
  key: string | number;
  size: number;
}

/**
 * 줄일 수 있는 배열을 모은다: 비어 있지 않고, 안에 비어 있지 않은 다른 배열이 없는 배열(가장 안쪽 배열).
 * 바깥 배열은 늘 안쪽보다 직렬화가 길어서, 이렇게 해야 `options.0.files` 같은 안쪽 목록부터 줄어든다.
 * 안쪽이 모두 비면 그 바깥 배열이 후보가 된다. 반환값 = 이 노드 아래에 비어 있지 않은 배열이 있는지.
 */
function collectArrays(
  node: unknown,
  parent: Record<string | number, unknown> | null,
  key: string | number,
  path: string[],
  out: ArrayRef[],
): boolean {
  if (Array.isArray(node)) {
    let nested = false;
    node.forEach((child: unknown, i) => {
      if (collectArrays(child, node as unknown as Record<number, unknown>, i, [...path, String(i)], out)) nested = true;
    });
    if (node.length === 0) return nested;
    if (!nested && parent !== null) out.push({ path: path.join("."), parent, key, size: toText(node).length });
    return true;
  }
  if (typeof node === "object" && node !== null) {
    let nested = false;
    for (const [k, child] of Object.entries(node)) {
      if (collectArrays(child, node as Record<string, unknown>, k, [...path, k], out)) nested = true;
    }
    return nested;
  }
  return false;
}

/**
 * 객체형 응답용 축약. 상한을 넘으면 직렬화가 가장 긴 (가장 안쪽) 배열을 반으로 줄이기를 반복한다.
 * 잘린 개수는 `omitted["options.0.files"]` 처럼 배열 경로별로 적고 `truncated: true`를 붙인다.
 * 입력은 바꾸지 않는다. 더 줄일 배열이 없으면 그대로 `truncated`만 붙인다.
 */
export function shrinkToBudget<T extends object>(
  value: T,
  budget: number,
): T & { truncated?: true; omitted?: Record<string, number> } {
  if (estimateTokens(toText(value)) <= budget) return value;

  const copy = structuredClone(value) as Record<string, unknown>;
  const omitted: Record<string, number> = {};
  copy.truncated = true;
  while (estimateTokens(toText(copy)) > budget) {
    const arrays: ArrayRef[] = [];
    collectArrays(copy, null, "", [], arrays);
    // 직렬화가 가장 긴 배열. 같으면 먼저 찾은(위쪽) 것.
    let longest: ArrayRef | undefined;
    for (const a of arrays) if (longest === undefined || a.size > longest.size) longest = a;
    if (longest === undefined) break;
    const target = longest.parent[longest.key] as unknown[];
    const keep = Math.floor(target.length / 2);
    omitted[longest.path] = (omitted[longest.path] ?? 0) + (target.length - keep);
    target.length = keep;
    copy.omitted = { ...omitted };
  }
  return copy as T & { truncated?: true; omitted?: Record<string, number> };
}
