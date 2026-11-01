import type { AuditResult } from "../audit-result.js";

const COLOR_LIMIT = 20;
const SPACING_LIMIT = 20;
const COMPONENT_LIMIT = 50;

/** 로컬 시간대 기준 YYYY-MM-DD. */
export function localDate(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 표 셀 안에서 표를 깨는 문자를 이스케이프한다. */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

function table(header: string[], rows: string[][]): string[] {
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
  ];
}

function more(shown: number, total: number): string[] {
  return total > shown ? ["", `외 ${total - shown}개 생략`] : [];
}

const NO_STYLE_DATA = "(스타일 데이터 없음 — 참고용)";

/** 파일은 분석했지만 평가한 스타일 값이 없어 점수가 산식의 기본값일 뿐인지. */
function hasNoStyleData(r: AuditResult): boolean {
  return r.health.rated === 0 && r.index.files.scanned > 0;
}

function scoreLine(r: AuditResult): string {
  return `${hasNoStyleData(r) ? `${NO_STYLE_DATA} ` : ""}건강 점수: ${r.health.score}`;
}

/** 감지됐지만 켜진 Extractor가 없어 분석하지 않은 스타일링 방식 이름. */
function unanalyzedMethods(r: AuditResult): string[] {
  return r.detect.styling.methods.map((m) => m.name).filter((name) => !r.detect.activeExtractors.includes(name));
}

function unanalyzedLine(names: string[]): string {
  return `감지됐지만 분석하지 않은 방식: ${names.join(", ")}`;
}

/** CLI가 stderr에 출력할 경고. 리포트의 참고용 표기·미분석 방식과 같은 조건, 같은 문구다. */
export function auditWarnings(r: AuditResult): string[] {
  const warnings: string[] = [];
  if (hasNoStyleData(r)) warnings.push(`경고: ${scoreLine(r)}`);
  const unanalyzed = unanalyzedMethods(r);
  if (unanalyzed.length > 0) warnings.push(`경고: ${unanalyzedLine(unanalyzed)}`);
  return warnings;
}

export function renderAuditReport(r: AuditResult): string {
  const { detect, index, hardcoded, health } = r;
  const empty = index.files.scanned === 0;
  const lines: string[] = [];

  lines.push("# DS Audit", "");
  lines.push(`- root: ${detect.root}`);
  lines.push(`- 날짜: ${localDate(new Date(detect.detectedAt))}`);
  lines.push(`- state: ${detect.state}`);
  lines.push(`- provisional: ${detect.provisional}`);
  lines.push(`- 분석한 파일: ${index.files.scanned}개 (스타일 사용 ${index.styleCount}, 컴포넌트 사용 ${index.componentCount})`);
  lines.push(`- 동적 값: ${r.dynamicCount}`);
  const unanalyzed = unanalyzedMethods(r);
  if (unanalyzed.length > 0) lines.push(`- ${unanalyzedLine(unanalyzed)}`);
  lines.push("");

  lines.push(scoreLine(r), "");
  lines.push(`산식: ${health.formula}`, "");
  lines.push(`- hardcodedShare: ${health.hardcodedShare}`);
  lines.push(`- dsImportShare: ${health.dsImportShare}`);
  lines.push(`- duplicateCount: ${health.duplicateCount}`);
  lines.push("");

  if (empty) {
    lines.push("분석할 파일 없음", "");
  }

  lines.push("## 하드코딩 색 후보", "");
  if (hardcoded.colors.length === 0) lines.push("없음");
  else {
    const shown = hardcoded.colors.slice(0, COLOR_LIMIT);
    lines.push(
      ...table(
        ["대표 hex", "사용 수", "제안 이름", "변종"],
        shown.map((c) => [
          c.representative.hex,
          String(c.total),
          c.suggestedName,
          c.members.map((m) => `${m.hex} ×${m.count}`).join(", "),
        ]),
      ),
      ...more(shown.length, hardcoded.colors.length),
    );
  }
  lines.push("");

  lines.push("## 간격 후보", "");
  if (hardcoded.spacing.length === 0) lines.push("없음");
  else {
    const shown = hardcoded.spacing.slice(0, SPACING_LIMIT);
    lines.push(
      ...table(
        ["px", "사용 수", "스케일"],
        shown.map((s) => [String(s.px), String(s.count), s.onScale ? "4px 배수" : "벗어남"]),
      ),
      ...more(shown.length, hardcoded.spacing.length),
    );
  }
  lines.push("");

  lines.push("## 컴포넌트 사용량", "");
  if (r.components.length === 0) lines.push("없음");
  else {
    const shown = r.components.slice(0, COMPONENT_LIMIT);
    lines.push(
      ...table(
        ["컴포넌트", "출처", "사용 수"],
        // 출처는 묶음 기준인 정규화된 module이다. 그룹의 importedFrom은 처음 본 표기라 서브패스·별칭이 섞여 있다.
        shown.map((c) => [c.name, c.module !== "" ? c.module : (c.importedFrom ?? "(출처 없음)"), String(c.count)]),
      ),
      ...more(shown.length, r.components.length),
    );
  }
  lines.push("");

  lines.push("## 중복 컴포넌트", "");
  if (r.duplicates.length === 0) lines.push("없음");
  else for (const d of r.duplicates) lines.push(`- ${d.names.join(", ")} (${d.reason})`);
  lines.push("");

  lines.push("## 지역 재정의 컴포넌트", "");
  if (r.localDefinitions.length === 0) lines.push("없음");
  else {
    lines.push(
      "같은 이름의 컴포넌트가 여러 파일에서 import 없이 쓰였습니다 — 파일마다 따로 정의됐을 가능성이 큽니다.",
      "",
      ...table(["컴포넌트", "정의 파일 수"], r.localDefinitions.map((d) => [d.name, String(d.files)])),
    );
  }
  lines.push("");

  lines.push("## 파일별 하드코딩 상위", "");
  if (hardcoded.byFile.length === 0) lines.push("없음");
  else lines.push(...table(["파일", "하드코딩 수"], hardcoded.byFile.map((f) => [f.file, String(f.count)])));
  lines.push("");

  lines.push("## 건너뜀", "");
  const skipped = index.files.skipped;
  lines.push(`건너뜀 ${skipped.length}개`);
  if (skipped.length > 0) {
    lines.push("");
    for (const s of skipped) lines.push(`- ${s.file}: ${s.reason}`);
  }
  lines.push("");

  return lines.join("\n");
}
