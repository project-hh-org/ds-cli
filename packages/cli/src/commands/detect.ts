import path from "node:path";
import { detect, writeDetect, type DetectResult } from "@ds-cli/detect";

/** detect를 실행하고 `.ds-cli/detect.json`에 저장한다. 결과는 provisional이다. */
export async function runDetect(root: string): Promise<DetectResult> {
  const absRoot = path.resolve(root);
  const result = await detect(absRoot);
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
