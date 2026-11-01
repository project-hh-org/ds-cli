import type { Finding, GuardPolicy } from "@dsmith-dev/core";
import type { GuardCiResult } from "./ci.js";

export const COMMENT_MARKER = "<!-- dsmith:guard -->";

const MAX_ROWS = 50;

const cell = (text: string): string => text.replace(/\|/g, "\\|").replace(/`/g, "'").replace(/\r?\n/g, " ");

function row(f: Finding): string {
  const s = f.style;
  if (s === undefined) return "";
  const suggestion = s.replacement === null ? "–" : `\`${cell(s.replacement.token)}\` (${s.replacement.confidence})`;
  return `| \`${cell(`${f.file}:${f.line}`)}\` | ${s.property} | \`${cell(s.raw)}\` | ${suggestion} |`;
}

/** PR 코멘트 본문. 결정적(시각·절대 경로 없음). */
export function renderComment(r: Omit<GuardCiResult, "body" | "comment">, policy: GuardPolicy): string {
  const out: string[] = [COMMENT_MARKER];
  if (r.staleSnapshot.length > 0) {
    out.push(`> ⚠ 토큰 파일이 guard.json보다 새것입니다 — dsmith guard init으로 갱신하세요 (${r.staleSnapshot.join(", ")})`, "");
  }
  out.push(
    "### dsmith guard",
    `기준 \`${r.base}\` (merge-base \`${r.mergeBase.slice(0, 7)}\`) · 검사한 변경 파일 ${r.files.length}`,
    "",
    "| 항목 | 신규 | 허용 |",
    "| --- | --- | --- |",
    `| 하드코딩 스타일 | ${r.counts.newHardcoded} (토큰으로 바꿀 수 있음 ${r.counts.newReplaceable}) | ${policy.failOn.newHardcoded} |`,
    `| DS 밖 컴포넌트 | ${r.counts.newNonDs} | – |`,
    `| deprecated 컴포넌트 | ${r.counts.newDeprecated} | ${policy.failOn.deprecated} |`,
    "",
  );

  const hardcoded = r.newFindings.filter((f) => f.rule === "no-hardcoded-style");
  if (hardcoded.length > 0) {
    out.push(
      `<details><summary>신규 하드코딩 ${hardcoded.length}건</summary>`,
      "",
      "| 위치 | 속성 | 값 | 제안 토큰 |",
      "| --- | --- | --- | --- |",
      ...hardcoded.slice(0, MAX_ROWS).map(row),
    );
    if (hardcoded.length > MAX_ROWS) out.push("", `… 외 ${hardcoded.length - MAX_ROWS}건`);
    out.push("</details>", "");
  }

  if (r.counts.removedHardcoded > 0 && r.newFindings.length === 0) {
    out.push(`이 PR이 하드코딩 ${r.counts.removedHardcoded}건을 줄였습니다`, "");
  }
  return `${out.join("\n").replace(/\n+$/, "")}\n`;
}
