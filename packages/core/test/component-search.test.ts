import { describe, expect, it } from "vitest";
import { COMPONENT_SYNONYMS, searchComponents } from "../src/component/search.js";
import type { ComponentSummary } from "../src/component/summary.js";

function s(name: string, usageCount: number, props: string[] = [], module = `src/${name}`): ComponentSummary {
  return { name, module, importedFrom: module, count: usageCount, files: [], props };
}

const summaries = [s("DatePicker", 5), s("Calendar", 2), s("Button", 9), s("Select", 3)];

describe("searchComponents", () => {
  it("한국어 의도: '날짜 고르는 입력' → DatePicker 첫 번째, Calendar 포함, Button 제외", () => {
    const result = searchComponents(summaries, "날짜 고르는 입력");
    expect(result[0]?.name).toBe("DatePicker");
    expect(result.map((r) => r.name)).toContain("Calendar");
    expect(result.map((r) => r.name)).not.toContain("Button");
  });

  it("dropdown → Select(동의어)와 why 문자열", () => {
    const result = searchComponents(summaries, "dropdown");
    expect(result).toEqual([
      { name: "Select", module: "src/Select", score: 2, why: "동의어 select→Select", usageCount: 3 },
    ]);
  });

  it("이름 조각 일치 +3과 동의어 +2와 props +1을 합산하고 why에 근거를 잇는다", () => {
    const result = searchComponents([s("DatePicker", 5, ["date", "onChange"])], "date");
    expect(result).toEqual([
      {
        name: "DatePicker",
        module: "src/DatePicker",
        score: 6,
        why: "이름 'date' 일치; 동의어 date→DatePicker; props 'date'",
        usageCount: 5,
      },
    ]);
  });

  it("정렬은 score → usageCount → name이다", () => {
    const result = searchComponents([s("Tag", 2), s("Chip", 4), s("Badge", 1)], "badge");
    // Badge: 이름 +3 동의어 +2, Chip·Tag: 동의어 +2(사용 수 내림차순)
    expect(result.map((r) => r.name)).toEqual(["Badge", "Chip", "Tag"]);
    const tie = searchComponents([s("Tag", 2), s("Chip", 2)], "badge");
    expect(tie.map((r) => r.name)).toEqual(["Chip", "Tag"]);
  });

  it("컴포넌트 이름은 camelCase/PascalCase/점으로 쪼개 일치시킨다", () => {
    const result = searchComponents([s("Form.TextInput", 1), s("KpiCard", 1)], "text");
    expect(result.map((r) => r.name)).toEqual(["Form.TextInput"]);
    expect(result[0]?.why).toBe("이름 'text' 일치");
  });

  it("module이 ''인 지역 사용은 제외한다", () => {
    expect(searchComponents([s("Button", 3, [], "")], "button")).toEqual([]);
  });

  it("점수 0은 제외하고 빈 의도는 빈 배열이다", () => {
    expect(searchComponents(summaries, "zzz")).toEqual([]);
    expect(searchComponents(summaries, "  ")).toEqual([]);
  });

  it("COMPONENT_SYNONYMS에 필수 항목이 있다", () => {
    expect(COMPONENT_SYNONYMS["date"]).toEqual(["DatePicker", "Calendar", "DateInput"]);
    expect(COMPONENT_SYNONYMS["card"]).toEqual(["Card", "Panel", "KpiCard"]);
    expect(Object.keys(COMPONENT_SYNONYMS)).toHaveLength(12);
  });
});
