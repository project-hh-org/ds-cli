import path from "node:path";
import { detect, MONOREPO_ROOT_EVIDENCE, writeDetect, type DetectResult } from "@dsmith-dev/detect";
import { metas } from "../registry.js";

export interface RunOptions {
  /** 기본 제외와 detect.json `overrides.exclude`에 더할 glob(CLI `--exclude`). 저장하지 않는다. */
  exclude?: string[];
}

/** detect를 실행하고 `.dsmith/detect.json`에 저장한다. 결과는 provisional이다. */
export async function runDetect(root: string, opts: RunOptions = {}): Promise<DetectResult> {
  const absRoot = path.resolve(root);
  const result = await detect(absRoot, undefined, { available: metas(), exclude: opts.exclude ?? [] });
  await writeDetect(absRoot, result);
  return result;
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function dsLabel(ds: DetectResult["ds"]): string {
  switch (ds.kind) {
    case "npm":
      return `npm (${(ds.packageNames ?? (ds.packageName !== undefined ? [ds.packageName] : [])).join(", ")})`;
    case "local":
      return `local (${ds.dir ?? ""})`;
    case "none":
      return "none";
  }
}

/** CLI가 stderr에 출력할 힌트. 모노레포 루트에서 실행하면 앱 디렉터리를 --root로 지정하라고 알린다. */
export function detectHints(r: DetectResult): string[] {
  const monorepo = r.styling.methods.some((m) => m.evidence.includes(MONOREPO_ROOT_EVIDENCE));
  return monorepo ? ["힌트: 모노레포 루트입니다. --root apps/<app> 로 실행하세요"] : [];
}

/** 사람이 읽는 5줄 요약. */
export function formatDetectSummary(r: DetectResult): string {
  const methods = r.styling.methods.map((m) => `${m.name} ${percent(m.share)}`).join(", ") || "없음";
  const framework = r.framework.router !== undefined ? `${r.framework.name} (${r.framework.router} router)` : r.framework.name;
  return [
    `state: ${r.state}${r.provisional ? " (provisional)" : ""}`,
    `스타일링: ${methods}`,
    `DS: ${dsLabel(r.ds)}`,
    `프레임워크: ${framework}`,
    `activeExtractors: ${r.activeExtractors.join(", ") || "없음"}`,
  ].join("\n");
}
