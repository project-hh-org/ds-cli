export interface TextPatch {
  start: number;
  end: number;
  replacement: string;
}

export interface PatchConflict {
  a: TextPatch;
  b: TextPatch;
}

/** start 오름차순, 같으면 길이 0(삽입)이 먼저. 나머지 동률은 입력 순서 유지(안정 정렬) — 같은 위치 삽입의 순서가 곧 결과 순서다 */
function byPosition(a: TextPatch, b: TextPatch): number {
  return a.start - b.start || a.end - a.start - (b.end - b.start);
}

/**
 * 같은 구간·같은 치환은 하나로 합친다(`merged`는 버린 개수). 구간이 겹치는(또는 한쪽이 다른 쪽을 포함하는) 패치는
 * 양쪽 모두 `conflicts`로 빼고 `accepted`에서 제외한다. 길이 0 삽입은 같은 위치의 다른 삽입·구간 경계와는 겹치지 않는 것으로 본다
 * (start === 다른 패치 end 허용, 구간 안쪽 위치는 겹침). `accepted`는 start 오름차순.
 */
export function partitionPatches(patches: TextPatch[]): {
  accepted: TextPatch[];
  conflicts: PatchConflict[];
  merged: number;
} {
  const seen = new Set<string>();
  const unique: TextPatch[] = [];
  for (const p of patches) {
    const key = `${p.start}:${p.end}:${p.replacement}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }
  unique.sort(byPosition);

  const conflicts: PatchConflict[] = [];
  const bad = new Set<TextPatch>();
  for (let i = 0; i < unique.length; i++) {
    const a = unique[i]!;
    for (let j = i + 1; j < unique.length; j++) {
      const b = unique[j]!;
      // 정렬상 b.start ≥ a.start. 삽입(a.end === a.start)은 b.start < a.end가 될 수 없고, 같은 start의 삽입은 b보다 먼저 정렬된다.
      if (b.start >= a.end) break;
      conflicts.push({ a, b });
      bad.add(a);
      bad.add(b);
    }
  }
  return { accepted: unique.filter((p) => !bad.has(p)), conflicts, merged: patches.length - unique.length };
}

/** accepted(비중첩 전제)를 start 내림차순으로 적용한다. 중첩이거나 범위를 벗어나면 Error(호출자 버그). */
export function applyPatches(code: string, patches: TextPatch[]): string {
  const sorted = [...patches].sort(byPosition);
  let prevEnd = 0;
  for (const p of sorted) {
    if (p.start < prevEnd || p.end < p.start || p.end > code.length) {
      throw new Error(`패치가 겹치거나 범위를 벗어남: [${p.start}, ${p.end})`);
    }
    prevEnd = p.end;
  }
  let out = code;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]!;
    out = out.slice(0, p.start) + p.replacement + out.slice(p.end);
  }
  return out;
}

/**
 * 적용 뒤 좌표의 역패치. 오름차순으로 누적 길이 차를 더해 [start', start'+replacement.length) → 원문 조각.
 * `applyPatches(applyPatches(c, p), invertPatches(c, p)) === c`.
 */
export function invertPatches(original: string, patches: TextPatch[]): TextPatch[] {
  const sorted = [...patches].sort(byPosition);
  const out: TextPatch[] = [];
  let delta = 0;
  for (const p of sorted) {
    const start = p.start + delta;
    out.push({ start, end: start + p.replacement.length, replacement: original.slice(p.start, p.end) });
    delta += p.replacement.length - (p.end - p.start);
  }
  return out;
}
