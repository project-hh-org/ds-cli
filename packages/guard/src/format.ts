import type { GuardInitResult } from "./init.js";

/** 사람이 읽는 `guard init` 요약. */
export function formatGuardInitSummary(r: GuardInitResult): string {
  const lines = [
    `${r.dryRun ? "[dry-run] " : ""}${r.snapshot}: 토큰 ${r.counts.tokens} · DS 컴포넌트 ${r.counts.dsComponents}(deprecated ${r.counts.deprecated}) · 우선 지정 ${r.counts.preferred}`,
    `ESLint: ${r.eslint}${r.eslintFile !== undefined ? ` (${r.eslintFile})` : ""}`,
  ];
  for (const o of r.outcomes) {
    lines.push(`  ${o.status} ${o.file}${o.region === "file" ? "" : ` [${o.region}]`}${o.reason !== undefined ? ` — ${o.reason}` : ""}`);
    if (o.diff !== undefined && r.dryRun) lines.push(o.diff.trimEnd());
  }
  if (r.workflow !== null) lines.push(`워크플로: ${r.workflow}`);
  for (const n of r.notes) lines.push(`- ${n}`);
  return lines.join("\n");
}
