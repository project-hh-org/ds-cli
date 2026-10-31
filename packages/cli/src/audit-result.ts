import type { ColorCluster, Index, SpacingCandidate } from "@ds-cli/core";
import type { DetectResult } from "@ds-cli/detect";

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
    formula: string;
  };
}
