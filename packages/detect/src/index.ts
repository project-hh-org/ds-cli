import path from "node:path";
import type { Index } from "@ds-cli/core";
import { detectDs, type DsDetection } from "./detect-ds.js";
import { detectFramework, type FrameworkDetection } from "./detect-framework.js";
import { detectLint, type LintDetection } from "./detect-lint.js";
import { decideState, sharesFromIndex, sharesFromSources } from "./detect-state.js";
import { detectStorybook } from "./detect-storybook.js";
import { activeExtractorsOf, detectStyling, type StylingDetection } from "./detect-styling.js";
import { loadSources, readDependencyNames } from "./fs-utils.js";
import { readDetect, writeDetect } from "./store.js";

export type { DsDetection } from "./detect-ds.js";
export type { FrameworkDetection } from "./detect-framework.js";
export type { LintDetection } from "./detect-lint.js";
export type { StylingDetection, StylingMethodName } from "./detect-styling.js";
export { decideState, sharesFromIndex } from "./detect-state.js";
export type { IndexShares, Shares } from "./detect-state.js";
export { readDetect, writeDetect } from "./store.js";

export interface DetectResult {
  version: 1;
  root: string;
  detectedAt: string;
  styling: StylingDetection;
  ds: DsDetection;
  framework: FrameworkDetection;
  storybook: boolean;
  lint: LintDetection;
  state: 0 | 1 | 2;
  activeExtractors: string[];
  /** index 없이 파일 스캔으로 추정한 값이면 true. audit가 index로 재감지하면 false. */
  provisional: boolean;
  /** 사람이 고친 값. 재감지해도 보존되고 새 결과 위에 적용된다. */
  overrides?: Partial<Pick<DetectResult, "state" | "activeExtractors" | "ds">>;
}

/**
 * 레포 환경을 감지한다.
 * index가 있으면 비율을 index에서, 없으면 파일 스캔으로 추정하고 `provisional: true`로 표시한다.
 * 기존 `.ds-cli/detect.json`에 overrides가 있으면 새 결과 위에 적용하고 보존한다.
 */
export async function detect(rootArg: string, index?: Index): Promise<DetectResult> {
  const root = path.resolve(rootArg);
  const existing = await readDetect(root);
  const overrides = existing?.overrides;

  const deps = await readDependencyNames(root);
  const sources = await loadSources(root);

  const styling = await detectStyling(root, { deps, sources, index });
  const dsDetected = await detectDs(root, deps);
  const framework = await detectFramework(root, deps);
  const storybook = await detectStorybook(root);
  const lint = await detectLint(root);

  // ds override는 state 판정에 쓰이는 DS 기준이므로 판정 전에 적용한다.
  const ds = overrides?.ds ?? dsDetected;
  const shares = index ? sharesFromIndex(index, ds) : sharesFromSources(sources, ds);
  const state = overrides?.state ?? decideState(ds, shares.dsImportShare, shares.hardcodedShare);

  const result: DetectResult = {
    version: 1,
    root,
    detectedAt: new Date().toISOString(),
    styling,
    ds,
    framework,
    storybook,
    lint,
    state,
    activeExtractors: overrides?.activeExtractors ?? activeExtractorsOf(styling),
    provisional: index === undefined,
  };
  if (overrides) result.overrides = overrides;
  return result;
}
