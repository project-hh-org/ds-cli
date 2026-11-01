/** 도구 응답 하나의 추정 토큰 상한 기본값. 목록형은 커서로, 객체형은 축약으로, 마지막엔 잘라서 지킨다. */
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

/** text가 상한을 넘으면 앞부분만 `{"truncated":true,"clipped":"…"}`로 감싸 상한 안으로 줄인다. 모든 응답의 마지막 방어선. */
export function clipJson(text: string, budget: number): string {
  if (estimateTokens(text) <= budget) return text;
  const wrapped = (n: number): string => toText({ truncated: true, clipped: text.slice(0, n) });
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (estimateTokens(wrapped(mid)) <= budget) lo = mid;
    else hi = mid - 1;
  }
  return wrapped(lo);
}

/** 오류 메시지를 상한 안으로 줄이고 끝에 …를 붙인다. */
export function clipMessage(text: string, budget: number): string {
  if (estimateTokens(text) <= budget) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (estimateTokens(`${text.slice(0, mid)}…`) <= budget) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

export interface Page<T> {
  items: T[];
  /** 커서와 무관한 전체 개수 */
  total: number;
  truncated: boolean;
  nextCursor?: string;
}

export interface PaginateOptions<T> {
  /**
   * 데이터 버전 표식. 주면 cursor는 `<offset>.<stamp>`이고, 표식이 다른 cursor(데이터나 인자가 바뀐 뒤)는 거절한다.
   */
  stamp?: string | undefined;
  /** 페이지에 실리는 원소에만 비용이 드는 필드를 붙인다. 원소는 한 번만 풍부해진다. */
  enrich?: ((item: T) => T) | undefined;
}

export const STALE_CURSOR = "데이터가 바뀜 — cursor 없이 다시";

function parseCursor(cursor: string | undefined, total: number, stamp: string | undefined): number {
  if (cursor === undefined) return 0;
  const bad = (): Error => new Error(`잘못된 cursor: ${JSON.stringify(cursor.slice(0, 40))}`);
  let offsetText = cursor;
  if (stamp !== undefined) {
    const m = /^(\d+)\.(.+)$/.exec(cursor);
    if (m === null) throw bad();
    if (m[2] !== stamp) throw new Error(STALE_CURSOR);
    offsetText = m[1] ?? "";
  }
  if (!/^\d+$/.test(offsetText)) throw bad();
  const offset = Number(offsetText);
  if (!Number.isSafeInteger(offset) || offset > total) throw bad();
  return offset;
}

/**
 * cursor부터 `wrap(page)` 직렬화가 budget 이하인 만큼 탐욕적으로 담는다. 최소 1개는 담는다.
 * 남는 항목이 있으면 truncated true + nextCursor. `enrich`가 있으면 먼저 원본 크기로 상한 개수를 잡은 뒤(풍부해지면 커질 뿐이므로 상한)
 * 그 범위 안에서만 풍부하게 만들어 다시 맞춘다.
 */
export function paginate<T>(
  items: T[],
  cursor: string | undefined,
  budget: number,
  wrap: (page: Page<T>) => object,
  opts: PaginateOptions<T> = {},
): object {
  const total = items.length;
  const start = parseCursor(cursor, total, opts.stamp);
  const remaining = total - start;

  const enriched = new Map<number, T>();
  const enrichedAt = (i: number): T => {
    const enrich = opts.enrich;
    if (enrich === undefined) return items[i] as T;
    let item = enriched.get(i);
    if (item === undefined) {
      item = enrich(items[i] as T);
      enriched.set(i, item);
    }
    return item;
  };
  const rawAt = (i: number): T => items[i] as T;

  const pageOf = (count: number, at: (i: number) => T): Page<T> => {
    const end = start + count;
    const slice: T[] = [];
    for (let i = start; i < end; i++) slice.push(at(i));
    const page: Page<T> = { items: slice, total, truncated: end < total };
    if (end < total) page.nextCursor = opts.stamp === undefined ? String(end) : `${end}.${opts.stamp}`;
    return page;
  };
  const fitCount = (max: number, at: (i: number) => T): number => {
    const fits = (count: number): boolean => estimateTokens(toText(wrap(pageOf(count, at)))) <= budget;
    if (max <= 1 || fits(max)) return max;
    // 이분 탐색: lo는 항상 상한 안(또는 최소 1개)이다.
    let lo = 1;
    let hi = max - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(mid)) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  let count = fitCount(remaining, rawAt);
  if (opts.enrich !== undefined) count = fitCount(count, enrichedAt);
  return wrap(pageOf(count, opts.enrich === undefined ? rawAt : enrichedAt));
}

interface Seg {
  s: string;
  /** 배열 인덱스면 true */
  idx: boolean;
}

interface Member {
  parent: Record<string | number, unknown>;
  key: string | number;
  path: Seg[];
}

const wildPath = (path: Seg[]): string => path.map((p) => (p.idx ? "*" : p.s)).join(".");
const concretePath = (path: Seg[]): string => path.map((p) => p.s).join(".");

/** 비어 있지 않은 배열을 바깥 → 안쪽 순서로 모은다. */
function collectArrays(node: unknown, parent: Member["parent"] | null, key: string | number, path: Seg[], out: Member[]): void {
  if (Array.isArray(node)) {
    if (node.length > 0 && parent !== null) out.push({ parent, key, path });
    node.forEach((child: unknown, i) => collectArrays(child, node as unknown as Member["parent"], i, [...path, { s: String(i), idx: true }], out));
  } else if (typeof node === "object" && node !== null) {
    for (const [k, child] of Object.entries(node)) collectArrays(child, node as Member["parent"], k, [...path, { s: k, idx: false }], out);
  }
}

export interface ShrinkOptions {
  /** true를 돌려주는 원소는 배열을 줄여도 남긴다. path는 배열의 구체 경로(`options`) */
  pin?: ((path: string, item: unknown) => boolean) | undefined;
  /** 한 번 줄일 때마다 부른다 — 줄어든 배열에 딸린 값(옵션 id로 키를 가진 맵 등)을 정리하는 데 쓴다 */
  afterCut?: ((copy: Record<string, unknown>) => void) | undefined;
}

type Shrunk<T> = T & { truncated?: true; omitted?: Record<string, number> };

/**
 * 객체형 응답용 축약. 상한을 넘으면 배열 묶음 하나를 골라 반으로 줄이기를 반복한다.
 * - 같은 위치의 형제 배열(`props[].values`)은 한 묶음이다. 묶음 이름은 와일드카드 경로(`props.*.values`), 줄이는 시점에 후보가 하나뿐이면 구체 경로(`options.0.files`).
 * - 묶음은 줄여서 덜어지는 바이트가 가장 큰 것을 고른다(바깥 배열도 안쪽과 겨룬다). 길이 1 배열은 다른 후보가 없을 때만 비운다.
 * - 잘린 개수는 `omitted[묶음 이름]`에 더하고 `truncated: true`를 붙인다. 입력은 바꾸지 않는다.
 * 최상위 값은 배열이 아닌 객체여야 한다.
 */
export function shrinkToBudget<T extends object>(value: T, budget: number, opts: ShrinkOptions = {}): Shrunk<T> {
  if (Array.isArray(value)) throw new TypeError("shrinkToBudget: 최상위 배열은 줄일 수 없음 — 객체로 감싸서 넘길 것");
  if (estimateTokens(toText(value)) <= budget) return value;

  const copy = structuredClone(value) as Record<string, unknown>;
  const omitted: Record<string, number> = {};
  copy.truncated = true;

  const pinned = (m: Member, item: unknown): boolean => opts.pin?.(concretePath(m.path), item) === true;
  const cuts = (m: Member): { keep: number; removed: unknown[]; kept: unknown[] } => {
    const arr = m.parent[m.key] as unknown[];
    const keep = Math.floor(arr.length / 2);
    const tail = arr.slice(keep);
    return { keep, removed: tail.filter((x) => !pinned(m, x)), kept: tail.filter((x) => pinned(m, x)) };
  };

  while (estimateTokens(toText(copy)) > budget) {
    const members: Member[] = [];
    collectArrays(copy, null, "", [], members);
    const groups = new Map<string, Member[]>();
    for (const m of members) {
      const k = wildPath(m.path);
      const g = groups.get(k);
      if (g) g.push(m);
      else groups.set(k, [m]);
    }

    let best: { name: string; members: Member[] } | undefined;
    let bestSaved = 0;
    for (const lengthOneOk of [false, true]) {
      for (const [wild, group] of groups) {
        const usable = lengthOneOk ? group : group.filter((m) => (m.parent[m.key] as unknown[]).length > 1);
        if (usable.length === 0) continue;
        let saved = 0;
        for (const m of usable) for (const el of cuts(m).removed) saved += toText(el).length + 1;
        if (saved > bestSaved) {
          bestSaved = saved;
          best = { name: usable.length === 1 ? concretePath((usable[0] as Member).path) : wild, members: usable };
        }
      }
      if (best !== undefined) break;
    }
    if (best === undefined) break;

    let removedCount = 0;
    for (const m of best.members) {
      const arr = m.parent[m.key] as unknown[];
      const { keep, removed, kept } = cuts(m);
      removedCount += removed.length;
      arr.length = keep;
      arr.push(...kept);
    }
    omitted[best.name] = (omitted[best.name] ?? 0) + removedCount;
    copy.omitted = { ...omitted };
    opts.afterCut?.(copy);
  }
  return copy as Shrunk<T>;
}
