import fs from "node:fs/promises";
import path from "node:path";
import {
  clusterColors,
  clusterSpacing,
  indexRepo,
  isRatedUsage,
  writeIndex,
  type ComponentUsage,
  type Index,
} from "@dsmith/core";
import { detect, sharesFromIndex, writeDetect, type DetectResult } from "@dsmith/detect";
import type { AuditResult } from "../audit-result.js";
import { buildExtractors, metas } from "../registry.js";
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

const LOCAL_DEFINITION_LIMIT = 20;

/** name+module로 묶는다. 서브패스·별칭이 달라도 같은 모듈이면 한 그룹이고, importedFrom은 처음 본 값을 표시한다. */
function componentsOf(usages: ComponentUsage[]): AuditResult["components"] {
  const groups = new Map<string, AuditResult["components"][number]>();
  for (const c of usages) {
    const key = JSON.stringify([c.name, c.module]);
    const g = groups.get(key);
    if (g) g.count += 1;
    else groups.set(key, { name: c.name, importedFrom: c.importedFrom, module: c.module, count: 1 });
  }
  return [...groups.values()].sort(
    (a, b) =>
      b.count - a.count ||
      a.name.localeCompare(b.name) ||
      (a.importedFrom ?? "").localeCompare(b.importedFrom ?? "") ||
      a.module.localeCompare(b.module),
  );
}

/**
 * 같은 이름이 둘 이상의 module에서 오는 컴포넌트 이름을 사용 수 내림차순으로 모은다.
 * import 없는 지역 사용(module "")은 출처로 세지 않는다 — 그건 localDefinitions가 따로 보고한다.
 */
function duplicatesOf(components: AuditResult["components"]): AuditResult["duplicates"] {
  const byName = new Map<string, { modules: Set<string>; total: number }>();
  for (const c of components) {
    const entry = byName.get(c.name) ?? { modules: new Set<string>(), total: 0 };
    if (c.module !== "") entry.modules.add(c.module);
    entry.total += c.count;
    byName.set(c.name, entry);
  }
  const names = [...byName.entries()]
    .filter(([, e]) => e.modules.size >= 2)
    .sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))
    .map(([name]) => name);
  return names.length === 0 ? [] : [{ names, reason: "same-name-different-source" }];
}

/** import 없이(importedFrom null) 둘 이상의 파일에서 쓴 이름. 파일 수 내림차순, 같으면 이름순, 상위 20개. */
function localDefinitionsOf(usages: ComponentUsage[]): AuditResult["localDefinitions"] {
  const filesByName = new Map<string, Set<string>>();
  for (const c of usages) {
    if (c.importedFrom !== null) continue;
    const files = filesByName.get(c.name) ?? new Set<string>();
    files.add(c.file);
    filesByName.set(c.name, files);
  }
  return [...filesByName.entries()]
    .map(([name, files]) => ({ name, files: files.size }))
    .filter((d) => d.files >= 2)
    .sort((a, b) => b.files - a.files || a.name.localeCompare(b.name))
    .slice(0, LOCAL_DEFINITION_LIMIT);
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
  const components = componentsOf(index.components);
  const duplicates = duplicatesOf(components);
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
 */
export async function runAudit(rootArg: string): Promise<{ result: AuditResult; reportPath: string }> {
  const root = path.resolve(rootArg);

  const provisional = await detect(root, undefined, { available: metas() });
  await writeDetect(root, provisional);

  const index = await indexRepo(root, buildExtractors(provisional.activeExtractors));
  await writeIndex(root, index);

  const refined = await detect(root, index, { available: metas() });
  await writeDetect(root, refined);

  const result = computeAudit(refined, index);

  const reportPath = path.join(root, ".dsmith", "reports", `audit-${localDate(new Date())}.md`);
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, renderAuditReport(result), "utf-8");
  return { result, reportPath };
}
