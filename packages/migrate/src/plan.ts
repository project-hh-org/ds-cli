import fs from "node:fs/promises";
import path from "node:path";
import picomatch from "picomatch";
import {
  COVERAGE_PROPERTIES,
  bestReplacement,
  extractFileStyles,
  extractorMatchers,
  isRatedUsage,
  listCssFiles,
  loadReplacementTokens,
  applyPatches,
  partitionPatches,
  readTailwindPreset,
  sha256Text,
  tokenCategoryOf,
  type Index,
  type TextPatch,
  type Token,
} from "@dsmith-dev/core";
import type { DetectResult } from "@dsmith-dev/detect";
import type { Extractor, StyleProperty, TokenRefContext } from "@dsmith-dev/extractor-api";
import { checkEdit } from "./verify.js";

export type TokenSkipReason =
  | "no-token-ref"
  | "no-patch"
  | "overlap"
  | "low-confidence"
  | "rolled-back"
  | "negative-value"
  | "zero-value"
  | "scss-variable"
  | "multi-value";
/** Task 5가 채움 */
export type ComponentSkipReason = "decision-pending" | "mapping-missing" | "spread-props" | "export-unknown" | "overlap" | "rolled-back";

export interface UsageRef {
  file: string;
  line: number;
  column: number;
  property: StyleProperty;
  raw: string;
  extractor: string;
}

export interface PlannedReplacement extends UsageRef {
  category: Token["category"];
  token: string;
  value: string;
  confidence: "exact" | "close";
  /** 매처 거리(색 ΔE_ok, 길이 px). 0이면 값이 정확히 같다 — exact라도 0이 아닐 수 있다 */
  distance: number;
  /** tokenRef 결과 */
  ref: string;
  patch: TextPatch;
}

export interface SkippedReplacement extends UsageRef {
  reason: TokenSkipReason;
  token?: string;
}

/** Task 5가 정의를 채운다. Task 4에서는 항상 빈 배열 */
export interface PlannedComponentEdit {
  patches: TextPatch[];
}

export interface FilePlan {
  file: string;
  /** 계획 시점 내용의 sha256Text */
  sha256: string;
  replacements: PlannedReplacement[];
  components: PlannedComponentEdit[];
  /** 최종(비중첩, start 오름차순) */
  patches: TextPatch[];
}

export interface ComponentPlanSummary {
  decided: number;
  files: number;
  imports: number;
  props: number;
  annotations: number;
  pending: number;
  held: Partial<Record<ComponentSkipReason, number>>;
}

export interface MigratePlan {
  tokens: { source: "token-file" | "catalog"; files: string[]; count: number; excludeDirs: string[] };
  preset: { version: 3 | 4; file: string; linked: boolean } | null;
  scope: {
    /** 범위 안에서 다시 추출한 파일 수 */
    files: number;
    /** hardcoded && isRatedUsage && COVERAGE_PROPERTIES, 0 이하 간격 제외 */
    total: number;
    /** total 중 bestReplacement !== null */
    candidates: number;
    /** total − candidates (가까운 토큰 없음) */
    far: number;
    /** source "dynamic" && isRatedUsage */
    dynamic: number;
    /** 0 이하 간격(분모 제외 — init 커버리지와 같은 규칙) */
    zeroOrNegative: number;
    /** 후보였지만 `--only components`·`--max-files`로 계획에서 뺀 치환 수(건너뜀이 아니라 범위 제한) */
    outOfRange: number;
  };
  /** Σ files[].replacements.length */
  planned: number;
  /** 계획된 치환의 신뢰도: identical = 거리 0, exact = 거리 > 0인 exact, close */
  confidence: { identical: number; exact: number; close: number };
  byCategory: Record<Token["category"], number>;
  skipped: Partial<Record<TokenSkipReason, number>>;
  /** file → line → column 순 */
  skippedItems: SkippedReplacement[];
  /** patches가 1개 이상인 파일만, file 순 */
  files: FilePlan[];
  components: ComponentPlanSummary;
  notes: string[];
}

export interface MigrateOptions {
  root: string;
  extractors: Extractor[];
  detect: DetectResult;
  index: Index;
  /** picomatch glob(root 상대) */
  files?: string[];
  category?: Token["category"];
  only?: "tokens" | "components";
  /** 기본 close. exact면 close 후보는 low-confidence로 건너뜀 */
  minConfidence?: "exact" | "close";
  /** patches가 있는 파일을 file 순으로 앞에서 n개 */
  maxFiles?: number;
}

const patchKey = (p: TextPatch): string => `${p.start}:${p.end}:${p.replacement}`;

/** 박스 단축 속성 — 한 선언에 값이 여러 개 올 수 있다(첫 피연산자만 치환하면 검증할 수 없음) */
const BOX_SHORTHAND: readonly StyleProperty[] = ["padding", "margin", "gap", "border-radius"];
/** 값 자리의 앞·뒤로 올 수 있는 구분 문자(이 밖의 문자가 공백 너머에 있으면 다른 피연산자) */
const VALUE_EDGE = /[:;{},"'`(\n\r]/;

/** 패치 구간이 같은 선언·문자열 안의 다른 피연산자와 공백으로 이어져 있는가 */
function hasSiblingOperand(code: string, p: TextPatch): boolean {
  let i = p.end;
  while (code[i] === " " || code[i] === "\t") i += 1;
  if (i > p.end && i < code.length && !VALUE_EDGE.test(code[i]!) && code[i] !== "!" && code[i] !== ")") return true;
  let j = p.start - 1;
  while (j >= 0 && (code[j] === " " || code[j] === "\t")) j -= 1;
  return j < p.start - 1 && j >= 0 && !VALUE_EDGE.test(code[j]!);
}

const emptyByCategory = (): Record<Token["category"], number> => ({ color: 0, spacing: 0, radius: 0, "font-size": 0 });

function compareRefs(a: UsageRef, b: UsageRef): number {
  return a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line || a.column - b.column;
}

function underDir(file: string, dir: string): boolean {
  return dir === "." ? true : file === dir || file.startsWith(`${dir}/`);
}

/**
 * 하드코딩 → 토큰 치환 계획. 파일을 쓰지 않는다.
 * 후보 = hardcoded ∧ isRatedUsage ∧ `bestReplacement !== null` (= core `replaceableToken`과 같은 판정).
 * 불변식: candidates + far === total, planned + Σskipped + outOfRange === candidates.
 */
export async function planMigration(opts: MigrateOptions): Promise<MigratePlan> {
  const { root, extractors, detect, index } = opts;
  const minConfidence = opts.minConfidence ?? "close";
  const notes: string[] = [];

  const rt = await loadReplacementTokens(root, detect.ds.tokenFiles);
  if (rt.source === "none") {
    throw new Error("치환할 토큰이 없음 — 먼저 `dsmith init`(토큰 초안) 또는 토큰 파일을 두세요");
  }
  notes.push(...rt.warnings);

  const tailwindVersion = detect.styling.tailwindVersion;
  const preset = await readTailwindPreset(root, {
    initDir: rt.excludeDirs[0] ?? null,
    ...(tailwindVersion === undefined ? {} : { tailwindVersion }),
    cssFiles: await listCssFiles(root),
  });
  if (preset !== null && !preset.linked) {
    notes.push(
      `Tailwind 프리셋(${preset.file})이 tailwind 설정에 연결되지 않아 임의값(bg-[color:var(--…)])으로 치환함 — 연결하면 클래스명(bg-ds-…)으로 바뀜`,
    );
  }
  const refCtx: TokenRefContext = preset !== null && preset.linked ? { preset } : {};

  for (const extractor of extractors) await extractor.prepare?.(root);
  const matchers = extractorMatchers(extractors);
  const byName = new Map(extractors.map((e) => [e.name, e]));

  const inGlob = opts.files === undefined || opts.files.length === 0 ? null : picomatch(opts.files, { dot: true });
  const excluded = new Set(rt.excludeFiles);
  const targets = [...new Set([...index.styles.map((u) => u.file), ...index.components.map((c) => c.file)])]
    .filter((f) => !excluded.has(f) && !rt.excludeDirs.some((d) => underDir(f, d)) && (inGlob === null || inGlob(f)))
    .sort();

  const scope: MigratePlan["scope"] = { files: 0, total: 0, candidates: 0, far: 0, dynamic: 0, zeroOrNegative: 0, outOfRange: 0 };
  const skipped: MigratePlan["skipped"] = {};
  const skippedItems: SkippedReplacement[] = [];
  const addSkip = (u: UsageRef, reason: TokenSkipReason, token?: string): void => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
    skippedItems.push({ file: u.file, line: u.line, column: u.column, property: u.property, raw: u.raw, extractor: u.extractor, reason, ...(token === undefined ? {} : { token }) });
  };

  let unverified = 0;
  const filePlans: FilePlan[] = [];
  for (const file of targets) {
    let code: string;
    let styles;
    try {
      code = await fs.readFile(path.resolve(root, file), "utf-8");
      styles = extractFileStyles({ root, file, code }, matchers).styles;
    } catch (err) {
      notes.push(`읽기 실패: ${file} (${err instanceof Error ? err.message : String(err)})`);
      continue;
    }
    scope.files += 1;

    const planned: PlannedReplacement[] = [];
    for (const u of styles) {
      if (!isRatedUsage(u)) continue;
      if (u.source === "dynamic") {
        scope.dynamic += 1;
        continue;
      }
      if (u.source !== "hardcoded" || !COVERAGE_PROPERTIES.includes(u.property)) continue;
      const category = tokenCategoryOf(u.property);
      if (category === null || (opts.category !== undefined && opts.category !== category)) continue;
      if (category === "spacing" && u.normalized.kind === "length" && u.normalized.px <= 0) {
        scope.zeroOrNegative += 1;
        continue;
      }
      scope.total += 1;
      const r = bestReplacement(u, rt.tokens);
      if (r === null) {
        scope.far += 1;
        continue;
      }
      scope.candidates += 1;
      const ref0: UsageRef = { file, line: u.line, column: u.column, property: u.property, raw: u.raw, extractor: u.extractor };
      if (minConfidence === "exact" && r.confidence === "close") {
        addSkip(ref0, "low-confidence", r.token.name);
        continue;
      }
      const isTailwind = u.extractor === "tailwind";
      // 방어 규칙: Extractor 버그에 기대지 않고 migrate가 먼저 거른다
      if (u.normalized.kind === "length" && u.normalized.px === 0) {
        addSkip(ref0, "zero-value", r.token.name);
        continue;
      }
      if (!isTailwind && u.raw.trim().startsWith("-")) {
        addSkip(ref0, "negative-value", r.token.name); // 토큰 참조로 바꾸면 부호가 사라진다
        continue;
      }
      if (!isTailwind && /[$@]/.test(u.raw)) {
        addSkip(ref0, "scss-variable", r.token.name);
        continue;
      }
      const extractor = byName.get(u.extractor);
      const ref = extractor?.tokenRef?.(r.token, u, refCtx) ?? null;
      if (extractor === undefined || ref === null) {
        addSkip(ref0, "no-token-ref", r.token.name);
        continue;
      }
      const w = extractor.write(u, ref);
      if (w === null) {
        addSkip(ref0, "no-patch", r.token.name);
        continue;
      }
      if (!isTailwind && BOX_SHORTHAND.includes(u.property) && hasSiblingOperand(code, w)) {
        addSkip(ref0, "multi-value", r.token.name); // 첫 피연산자만 바꾸면 검증할 수 없다
        continue;
      }
      planned.push({
        ...ref0,
        category,
        token: r.token.name,
        value: r.token.value,
        confidence: r.confidence,
        distance: r.distance,
        ref,
        patch: { start: w.start, end: w.end, replacement: w.replacement },
      });
    }
    if (planned.length === 0) continue;

    // 파일당 파티션은 한 번: 토큰 패치 → (Task 5) 컴포넌트 패치 순으로 한 목록에 모아 partitionPatches
    const { accepted, conflicts } = partitionPatches(planned.map((r) => r.patch));
    const bad = new Set<string>();
    for (const c of conflicts) {
      bad.add(patchKey(c.a));
      bad.add(patchKey(c.b));
    }
    const replacements: PlannedReplacement[] = [];
    for (const r of planned) {
      if (bad.has(patchKey(r.patch))) addSkip(r, "overlap", r.token);
      else replacements.push(r);
    }
    if (accepted.length === 0) continue;

    // 치환 뒤 다시 읽어 확인한다(적용 단계와 같은 검사). 통과하지 못하면 사용별로 따로 확인해 걸리는 것만 no-patch로 보류한다
    // (예: 다중 값 단축 속성의 일부만 바꾸면 Extractor가 그 자리를 토큰으로 읽지 못함)
    const verify = (reps: PlannedReplacement[]): boolean => {
      try {
        const after = applyPatches(code, partitionPatches(reps.map((r) => r.patch)).accepted);
        return checkEdit(root, file, code, after, reps.length, matchers) === null;
      } catch {
        return false;
      }
    };
    let kept = replacements;
    if (!verify(kept)) {
      const groups = new Map<string, PlannedReplacement[]>();
      for (const r of replacements) groups.set(patchKey(r.patch), [...(groups.get(patchKey(r.patch)) ?? []), r]);
      kept = [];
      for (const group of groups.values()) {
        if (verify(group)) kept.push(...group);
        else for (const r of group) addSkip(r, "no-patch", r.token);
      }
      kept.sort((a, b) => a.line - b.line || a.column - b.column);
      unverified += replacements.length - kept.length;
    }
    if (kept.length === 0) continue;
    filePlans.push({
      file,
      sha256: sha256Text(code),
      replacements: kept,
      components: [],
      patches: partitionPatches(kept.map((r) => r.patch)).accepted,
    });
  }

  if (unverified > 0) {
    notes.push(`${unverified}건은 치환 뒤 다시 읽어도 토큰으로 확인되지 않아 건너뜀(no-patch) — 다중 값 단축 속성의 일부 등`);
  }
  let files = filePlans;
  if (opts.only === "components") {
    scope.outOfRange += files.reduce((n, f) => n + f.replacements.length, 0);
    files = [];
  } else if (opts.maxFiles !== undefined && files.length > opts.maxFiles) {
    const dropped = files.slice(opts.maxFiles);
    scope.outOfRange += dropped.reduce((n, f) => n + f.replacements.length, 0);
    notes.push(`범위 제한으로 ${dropped.length}개 파일 제외`);
    files = files.slice(0, opts.maxFiles);
  }

  const byCategory = emptyByCategory();
  const confidence = { identical: 0, exact: 0, close: 0 };
  let plannedCount = 0;
  for (const f of files) {
    for (const r of f.replacements) {
      plannedCount += 1;
      byCategory[r.category] += 1;
      if (r.confidence === "close") confidence.close += 1;
      else if (r.distance === 0) confidence.identical += 1;
      else confidence.exact += 1;
    }
  }

  return {
    tokens: { source: rt.source, files: rt.files, count: rt.tokens.length, excludeDirs: rt.excludeDirs },
    preset: preset === null ? null : { version: preset.version, file: preset.file, linked: preset.linked },
    scope,
    planned: plannedCount,
    confidence,
    byCategory,
    skipped,
    skippedItems: skippedItems.sort(compareRefs),
    files,
    components: { decided: 0, files: 0, imports: 0, props: 0, annotations: 0, pending: 0, held: {} },
    notes,
  };
}
