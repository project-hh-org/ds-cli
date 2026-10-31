import { isRatedUsage, type Index } from "@ds-cli/core";
import { isDsSpecifier, type DsDetection } from "./detect-ds.js";
import type { SourceFile } from "./fs-utils.js";

/**
 * 시작 상태를 판정한다.
 * - 0: DS 없음
 * - 1: DS는 있으나 도입이 약함(import 비율 50% 미만 또는 하드코딩 30% 초과)
 * - 2: DS가 쓰이고 있음
 */
export function decideState(ds: DsDetection, dsImportShare: number, hardcodedShare: number): 0 | 1 | 2 {
  if (ds.kind === "none") return 0;
  if (dsImportShare < 0.5 || hardcodedShare > 0.3) return 1;
  return 2;
}

export interface Shares {
  /** 스타일 값 중 하드코딩 비율 0~1 */
  hardcodedShare: number;
  /** 컴포넌트 사용 중 DS에서 가져온 비율 0~1 */
  dsImportShare: number;
}

function ratio(n: number, d: number): number {
  return d === 0 ? 0 : n / d;
}

export interface IndexShares extends Shares {
  /** hardcodedShare의 분모: 평가한 스타일 usage 수 */
  rated: number;
}

/** 인덱스 기반의 정확한 비율. */
export function sharesFromIndex(index: Index, ds: DsDetection): IndexShares {
  // 디자인 속성이 아니거나 정규화되지 않은 값은 분자·분모 모두에서 뺀다. dynamic은 분모에서 제외한다.
  const ratedUsages = index.styles.filter((u) => u.source !== "dynamic" && isRatedUsage(u));
  const hardcoded = ratedUsages.filter((u) => u.source === "hardcoded").length;
  const rated = ratedUsages.length;
  const fromDs =
    ds.kind === "none"
      ? 0
      : index.components.filter((c) => c.importedFrom !== null && isDsSpecifier(c.importedFrom, ds)).length;
  return {
    hardcodedShare: ratio(hardcoded, rated),
    dsImportShare: ratio(fromDs, index.components.length),
    rated,
  };
}

const HEX_OR_ARBITRARY = /#[0-9a-fA-F]{3,8}|-\[/;
const IMPORT_SPECIFIER = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g;

/** index가 없을 때의 근사: 파일 단위 비율. */
export function sharesFromSources(sources: SourceFile[], ds: DsDetection): Shares {
  const hardcodedFiles = sources.filter((s) => HEX_OR_ARBITRARY.test(s.content)).length;
  const dsFiles =
    ds.kind === "none"
      ? 0
      : sources.filter((s) => {
          for (const m of s.content.matchAll(IMPORT_SPECIFIER)) {
            if (m[1] !== undefined && isDsSpecifier(m[1], ds)) return true;
          }
          return false;
        }).length;
  return {
    hardcodedShare: ratio(hardcodedFiles, sources.length),
    dsImportShare: ratio(dsFiles, sources.length),
  };
}
