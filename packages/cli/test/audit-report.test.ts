import { describe, expect, it } from "vitest";
import type { AuditResult } from "../src/audit-result.js";
import { renderAuditReport } from "../src/report/audit-report.js";

const FORMULA = "100 × (0.5×(1−hardcodedShare) + 0.3×dsImportShare + 0.2×max(0, 1−duplicateCount/10))";

function fixture(): AuditResult {
  return {
    detect: {
      version: 1,
      root: "/repo/app",
      detectedAt: "2026-10-31T12:00:00.000Z",
      styling: { methods: [{ name: "tailwind", evidence: [], share: 0.8 }] },
      ds: { kind: "local", dir: "src/ui", tokenFiles: [] },
      framework: { name: "next", router: "app" },
      storybook: false,
      lint: { tool: "eslint" },
      state: 1,
      activeExtractors: ["tailwind", "inline-style"],
      provisional: false,
    },
    index: { files: { scanned: 12, skipped: [{ file: "src/bad.tsx", reason: "parse: Unexpected token" }] }, styleCount: 40, componentCount: 90 },
    hardcoded: {
      colors: [
        {
          representative: { kind: "color", hex: "#3b82f6", l: 0.62, c: 0.2, h: 260 },
          members: [
            { hex: "#3b82f6", count: 5 },
            { hex: "#3c83f7", count: 2 },
          ],
          total: 7,
          suggestedName: "blue-400",
        },
      ],
      spacing: [
        { px: 13, count: 4, onScale: false },
        { px: 16, count: 3, onScale: true },
      ],
      byFile: [{ file: "src/pages/Home.tsx", count: 9 }],
    },
    dynamicCount: 3,
    components: [
      { name: "Button", importedFrom: "src/ui/Button", module: "src/ui/Button", count: 71 },
      { name: "Card", importedFrom: null, module: "", count: 2 },
    ],
    duplicates: [{ names: ["Button"], reason: "same-name-different-source" }],
    localDefinitions: [
      { name: "Header", files: 3 },
      { name: "Card", files: 2 },
    ],
    health: { score: 62, hardcodedShare: 0.25, dsImportShare: 0.4, duplicateCount: 1, rated: 32, formula: FORMULA },
  };
}

describe("renderAuditReport", () => {
  const md = renderAuditReport(fixture());

  it("제목·헤더 블록에 root, 날짜, state, provisional, 동적 값 수를 표기한다", () => {
    expect(md).toContain("# DS Audit");
    expect(md).toContain("/repo/app");
    expect(md).toContain("2026-10-31");
    expect(md).toMatch(/state.*1/);
    expect(md).toContain("provisional: false");
    expect(md).toContain("- 동적 값: 3\n");
  });

  it("건강 점수와 산식, 세 입력값을 표기한다", () => {
    expect(md).toContain("건강 점수: 62");
    expect(md).toContain(FORMULA);
    expect(md).toContain("hardcodedShare");
    expect(md).toContain("0.25");
    expect(md).toContain("dsImportShare");
    expect(md).toContain("0.4");
    expect(md).toContain("duplicateCount");
  });

  it("하드코딩 색 후보 표에 사용 수가 대표 hex 바로 뒤에 온다", () => {
    expect(md).toContain("## 하드코딩 색 후보");
    expect(md).toContain("| 대표 hex | 사용 수 | 제안 이름 | 변종 |");
    expect(md).toContain("| #3b82f6 | 7 | blue-400 | #3b82f6 ×5, #3c83f7 ×2 |");
  });

  it("간격 후보 표를 그린다", () => {
    expect(md).toContain("## 간격 후보");
    expect(md).toContain("| px | 사용 수 | 스케일 |");
    expect(md).toContain("| 13 | 4 | 벗어남 |");
    expect(md).toContain("| 16 | 3 | 4px 배수 |");
  });

  it("컴포넌트 사용량 표와 중복 컴포넌트를 그린다", () => {
    expect(md).toContain("| 컴포넌트 | 출처 | 사용 수 |");
    expect(md).toContain("| Button | src/ui/Button | 71 |");
    expect(md).toContain("| Card | (출처 없음) | 2 |");
    expect(md).toContain("## 중복 컴포넌트");
    expect(md).toContain("Button");
  });

  it("컴포넌트 사용량의 출처는 묶음 기준인 정규화된 module이다(서브패스·별칭 importedFrom이 아니라)", () => {
    const base = fixture();
    const out = renderAuditReport({
      ...base,
      components: [
        { name: "Stack", importedFrom: "@mui/material/Stack", module: "@mui/material", count: 5 },
        { name: "Card", importedFrom: "@src/components/Card", module: "src/components/Card", count: 3 },
        { name: "Header", importedFrom: null, module: "", count: 1 },
      ],
    });
    expect(out).toContain("| Stack | @mui/material | 5 |");
    expect(out).toContain("| Card | src/components/Card | 3 |");
    expect(out).toContain("| Header | (출처 없음) | 1 |");
    expect(out).not.toContain("@mui/material/Stack");
  });

  it("중복 컴포넌트 다음에 지역 재정의 컴포넌트 표와 설명을 그린다", () => {
    const section = md.slice(md.indexOf("## 지역 재정의 컴포넌트"), md.indexOf("## 파일별 하드코딩 상위"));
    expect(md.indexOf("## 중복 컴포넌트")).toBeLessThan(md.indexOf("## 지역 재정의 컴포넌트"));
    expect(section).toContain("| 컴포넌트 | 정의 파일 수 |");
    expect(section).toContain("| Header | 3 |\n| Card | 2 |");
    expect(section).toContain(
      "같은 이름의 컴포넌트가 여러 파일에서 import 없이 쓰였습니다 — 파일마다 따로 정의됐을 가능성이 큽니다.",
    );
  });

  it("지역 재정의가 없으면 없음으로 표기한다", () => {
    const none = fixture();
    none.localDefinitions = [];
    const out = renderAuditReport(none);
    const section = out.slice(out.indexOf("## 지역 재정의 컴포넌트"), out.indexOf("## 파일별 하드코딩 상위"));
    expect(section).toBe("## 지역 재정의 컴포넌트\n\n없음\n\n");
  });

  it("파일별 하드코딩 상위와 건너뜀을 그린다", () => {
    expect(md).toContain("## 파일별 하드코딩 상위");
    expect(md).toContain("| src/pages/Home.tsx | 9 |");
    expect(md).toContain("## 건너뜀");
    expect(md).toContain("건너뜀 1개");
    expect(md).toContain("src/bad.tsx");
  });

  it("빈 레포면 분석할 파일 없음을 표기한다", () => {
    const empty = fixture();
    empty.index = { files: { scanned: 0, skipped: [] }, styleCount: 0, componentCount: 0 };
    empty.hardcoded = { colors: [], spacing: [], byFile: [] };
    empty.components = [];
    empty.duplicates = [];
    empty.health = { score: 0, hardcodedShare: 0, dsImportShare: 0, duplicateCount: 0, rated: 0, formula: FORMULA };
    const out = renderAuditReport(empty);
    expect(out).toContain("분석할 파일 없음");
    expect(out).toContain("건강 점수: 0");
    expect(out).toContain(FORMULA);
  });
});
