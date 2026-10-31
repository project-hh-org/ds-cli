import type { ColorCluster, Index, SpacingCandidate } from "@dsmith/core";
import type { DetectResult } from "@dsmith/detect";

export interface AuditResult {
  detect: DetectResult;
  index: Pick<Index, "files"> & { styleCount: number; componentCount: number };
  hardcoded: {
    colors: ColorCluster[];
    spacing: SpacingCandidate[];
    byFile: { file: string; count: number }[];
  };
  dynamicCount: number;
  /** count 내림차순 */
  components: { name: string; importedFrom: string | null; count: number }[];
  /** 같은 이름이 둘 이상의 importedFrom에서 올 때 */
  duplicates: { names: string[]; reason: "same-name-different-source" }[];
  health: {
    score: number;
    hardcodedShare: number;
    dsImportShare: number;
    duplicateCount: number;
    /** hardcodedShare의 분모: 평가한 스타일 usage 수. 0이면 점수는 참고용이다. */
    rated: number;
    formula: string;
  };
}
