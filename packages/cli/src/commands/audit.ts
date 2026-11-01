import fs from "node:fs/promises";
import path from "node:path";
import {
  clusterColors,
  clusterSpacing,
  duplicateNames,
  indexRepo,
  isRatedUsage,
  localDefinitionsOf,
  summarizeComponents,
  writeIndex,
  type Index,
} from "@dsmith-dev/core";
import { detect, excludeGlobs, sharesFromIndex, writeDetect, type DetectResult } from "@dsmith-dev/detect";
import type { AuditResult } from "../audit-result.js";
import { buildExtractors, metas } from "../registry.js";
import type { RunOptions } from "./detect.js";
import { localDate, renderAuditReport } from "../report/audit-report.js";

export type { AuditResult } from "../audit-result.js";

export const HEALTH_FORMULA = "100 × (0.5×(1−hardcodedShare) + 0.3×dsImportShare + 0.2×max(0, 1−duplicateCount/10))";

const BY_FILE_LIMIT = 20;

function byFileOf(index: Index): AuditResult["hardcoded"]["byFile"] {
  const counts = new Map<string, number>();
  for (const u of index.styles) {
    if (u.source === "hardcoded" && isRatedUsage(u)) counts.set(u.file, (counts.get(u.file) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([file, count]) => ({ file, count }))
    .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file))
    .slice(0, BY_FILE_LIMIT);
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function healthOf(index: Index, ds: DetectResult["ds"], duplicateCount: number): AuditResult["health"] {
  const shares = sharesFromIndex(index, ds);
  // 점수는 반올림 전 비율로 계산하고, 표시용 필드만 4자리로 반올림한다.
  // 분석할 파일이 없으면 점수는 0으로 고정한다.
  const score =
    index.files.scanned === 0
      ? 0
      : Math.round(
          100 *
            (0.5 * (1 - shares.hardcodedShare) +
              0.3 * shares.dsImportShare +
              0.2 * Math.max(0, 1 - duplicateCount / 10)),
        );
  return {
    score,
    hardcodedShare: round4(shares.hardcodedShare),
    dsImportShare: round4(shares.dsImportShare),
    duplicateCount,
    rated: shares.rated,
    formula: HEALTH_FORMULA,
  };
}

export function computeAudit(detectResult: DetectResult, index: Index): AuditResult {
  const summaries = summarizeComponents(index.components);
  // props·files는 결과 JSON에 싣지 않는다(AuditResult 모양 불변)
  const components = summaries.map(({ name, importedFrom, module, count }) => ({ name, importedFrom, module, count }));
  const duplicateList = duplicateNames(summaries);
  const duplicates: AuditResult["duplicates"] =
    duplicateList.length === 0 ? [] : [{ names: duplicateList, reason: "same-name-different-source" }];
  const duplicateCount = duplicates.reduce((n, d) => n + d.names.length, 0);
  return {
    detect: detectResult,
    index: { files: index.files, styleCount: index.styles.length, componentCount: index.components.length },
    hardcoded: {
      colors: clusterColors(index.styles),
      spacing: clusterSpacing(index.styles),
      byFile: byFileOf(index),
    },
    dynamicCount: index.styles.filter((u) => u.source === "dynamic").length,
    components,
    duplicates,
    localDefinitions: localDefinitionsOf(index.components),
    health: healthOf(index, detectResult.ds, duplicateCount),
  };
}

/**
 * 감지(잠정) → 인덱싱 → 재감지(정제) → 집계 → 리포트 저장.
 * 대상 레포에는 `.dsmith/`만 쓴다.
 * 제외 glob = 기본 제외 + detect.json `overrides.exclude` + `opts.exclude`(감지·인덱싱 모두).
 */
export async function runAudit(rootArg: string, opts: RunOptions = {}): Promise<{ result: AuditResult; reportPath: string }> {
  const root = path.resolve(rootArg);
  const runExclude = opts.exclude ?? [];

  const provisional = await detect(root, undefined, { available: metas(), exclude: runExclude });
  await writeDetect(root, provisional);

  const index = await indexRepo(root, buildExtractors(provisional.activeExtractors), {
    exclude: excludeGlobs(provisional.overrides, runExclude),
  });
  await writeIndex(root, index);

  const refined = await detect(root, index, { available: metas(), exclude: runExclude });
  await writeDetect(root, refined);

  const result = computeAudit(refined, index);

  const reportPath = path.join(root, ".dsmith", "reports", `audit-${localDate(new Date())}.md`);
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, renderAuditReport(result), "utf-8");
  return { result, reportPath };
}
