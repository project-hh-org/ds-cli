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
  /** name+module로 묶은 사용 수(내림차순). importedFrom은 그룹에서 처음 본 값(표시용). */
  components: { name: string; importedFrom: string | null; module: string; count: number }[];
  /** 같은 이름이 둘 이상의 module(import 없는 지역 사용은 제외)에서 올 때 */
  duplicates: { names: string[]; reason: "same-name-different-source" }[];
  /** import 없이 둘 이상의 파일에서 쓴 이름(파일마다 따로 정의했을 가능성). 파일 수 내림차순, 상위 20개. */
  localDefinitions: { name: string; files: number }[];
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
