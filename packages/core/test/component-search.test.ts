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

  it("정확한 컴포넌트 이름(camelCase)을 의도로 주면 그 컴포넌트가 첫 번째다", () => {
    const list = [s("Button", 9), s("PrimaryButton", 1), s("Badge", 5, [], "a/Badge"), s("Badge", 4, [], "b/Badge"), s("StatusBadge", 1), s("StatusChip", 1)];
    const primary = searchComponents(list, "PrimaryButton");
    expect(primary[0]?.name).toBe("PrimaryButton");
    expect(primary[0]?.why).toContain("이름 전체 일치");
    expect(searchComponents(list, "StatusBadge")[0]?.name).toBe("StatusBadge");
    expect(searchComponents(list, "StatusChip")[0]?.name).toBe("StatusChip");
  });

  it("동점이면 module 순으로 안정 정렬한다", () => {
    const list = [s("Badge", 1, [], "z/Badge"), s("Badge", 1, [], "a/Badge")];
    expect(searchComponents(list, "badge").map((r) => r.module)).toEqual(["a/Badge", "z/Badge"]);
  });

  it("한국어는 조사까지만 허용한다", () => {
    const list = [s("Table", 1), s("Tabs", 1), s("Checkbox", 1), s("Select", 1)];
    expect(searchComponents(list, "표를 그리는")[0]?.name).toBe("Table");
    expect(searchComponents(list, "탭을 바꾸는")[0]?.name).toBe("Tabs");
    expect(searchComponents(list, "체크아웃").map((r) => r.name)).not.toContain("Checkbox");
    expect(searchComponents(list, "선택적 라벨").map((r) => r.name)).not.toContain("Select");
    expect(searchComponents(list, "표시").map((r) => r.name)).not.toContain("Table");
  });

  it("props는 camelCase 조각으로만 맞춘다(date는 updatedAt에 안 맞고 onDateChange에 맞는다)", () => {
    expect(searchComponents([s("Foo", 1, ["updatedAt"])], "date")).toEqual([]);
    expect(searchComponents([s("Foo", 1, ["onDateChange"])], "date")[0]?.why).toBe("props 'onDateChange'");
  });

  it("영어 복수형은 단수형으로도 찾는다", () => {
    expect(searchComponents([s("Button", 1)], "buttons")[0]?.name).toBe("Button");
    expect(searchComponents([s("Badge", 1)], "badges")[0]?.name).toBe("Badge");
  });
});
