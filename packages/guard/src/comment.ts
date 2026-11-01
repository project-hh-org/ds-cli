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

function componentRow(f: Finding): string {
  const c = f.component;
  if (c === undefined) return "";
  const detail = c.deprecated !== undefined && c.deprecated !== "" ? c.deprecated : c.preferModule !== undefined ? `${c.preferModule} 사용` : "–";
  return `| \`${cell(`${f.file}:${f.line}`)}\` | ${cell(c.name)} | \`${cell(c.module)}\` | ${cell(detail)} |`;
}

function details(out: string[], summary: string, header: string[], rows: string[], total: number): void {
  out.push(`<details><summary>${summary}</summary>`, "", ...header, ...rows.slice(0, MAX_ROWS));
  if (total > MAX_ROWS) out.push("", `… 외 ${total - MAX_ROWS}건`);
  out.push("</details>", "");
}

/** PR 코멘트 본문. 결정적(시각·절대 경로 없음). */
export function renderComment(r: Omit<GuardCiResult, "body" | "comment">, policy: GuardPolicy): string {
  const out: string[] = [COMMENT_MARKER];
  if (r.staleSnapshot.length > 0) {
    out.push(`> ⚠ 토큰 파일이 guard.json보다 새것입니다 — dsmith guard init으로 갱신하세요 (${r.staleSnapshot.join(", ")})`, "");
  }
  if (r.policyChanged) out.push("> ℹ 이 PR이 guard 정책을 바꿉니다 (기준: merge-base 정책 적용)", "");
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

  const nonDs = r.newFindings.filter((f) => f.rule === "prefer-ds-component");
  if (nonDs.length > 0) {
    details(out, `신규 DS 밖 컴포넌트 ${nonDs.length}건`, ["| 위치 | 컴포넌트 | 모듈 | 권장 |", "| --- | --- | --- | --- |"], nonDs.map(componentRow), nonDs.length);
  }
  const deprecated = r.newFindings.filter((f) => f.rule === "no-deprecated-component");
  if (deprecated.length > 0) {
    details(out, `신규 deprecated 컴포넌트 ${deprecated.length}건`, ["| 위치 | 컴포넌트 | 모듈 | 사유 |", "| --- | --- | --- | --- |"], deprecated.map(componentRow), deprecated.length);
  }

  if (r.parseFailed.length > 0) {
    out.push(`파싱 실패 ${r.parseFailed.length}건 (검사하지 못했습니다)`, "", ...r.parseFailed.slice(0, MAX_ROWS).map((f) => `- \`${cell(f)}\``));
    if (r.parseFailed.length > MAX_ROWS) out.push(`- … 외 ${r.parseFailed.length - MAX_ROWS}건`);
    out.push("");
  }

  if (r.counts.removedHardcoded > 0 && r.newFindings.length === 0) {
    out.push(`이 PR이 하드코딩 ${r.counts.removedHardcoded}건을 줄였습니다`, "");
  }
  return `${out.join("\n").replace(/\n+$/, "")}\n`;
}
