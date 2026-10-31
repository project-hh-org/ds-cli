import { describe, expect, it } from "vitest";
import { parseClassString } from "../src/class-parser.js";

describe("parseClassString", () => {
  it("variant와 arbitrary 값을 분리한다", () => {
    expect(parseClassString("md:hover:text-[#3B82F6]")).toEqual([
      {
        raw: "md:hover:text-[#3B82F6]",
        variants: ["md", "hover"],
        utility: "text",
        value: "#3B82F6",
        arbitrary: true,
        negative: false,
      },
    ]);
  });

  it("음수 접두를 negative로 분리한다", () => {
    expect(parseClassString("-mt-2")).toEqual([
      { raw: "-mt-2", variants: [], utility: "mt", value: "2", arbitrary: false, negative: true },
    ]);
  });

  it("variant 뒤의 음수 접두도 인식한다", () => {
    expect(parseClassString("md:-mt-2")[0]).toMatchObject({
      variants: ["md"],
      utility: "mt",
      value: "2",
      negative: true,
    });
  });

  it("p-[13px]는 arbitrary다", () => {
    expect(parseClassString("p-[13px]")[0]).toMatchObject({
      utility: "p",
      value: "13px",
      arbitrary: true,
      negative: false,
    });
  });

  it("arbitrary 값의 _는 공백으로 바꾼다", () => {
    expect(parseClassString("p-[1px_2px]")[0]).toMatchObject({ value: "1px 2px", arbitrary: true });
  });

  it("value가 없는 유틸리티는 value null이다", () => {
    expect(parseClassString("flex")[0]).toMatchObject({
      raw: "flex",
      utility: "flex",
      value: null,
      arbitrary: false,
    });
  });

  it("알려진 접두가 없으면 토큰 전체가 utility다", () => {
    expect(parseClassString("flex-col")[0]).toMatchObject({ utility: "flex-col", value: null });
    expect(parseClassString("items-center")[0]).toMatchObject({ utility: "items-center", value: null });
  });

  it("가장 긴 접두를 우선한다", () => {
    expect(parseClassString("px-4")[0]).toMatchObject({ utility: "px", value: "4" });
    expect(parseClassString("gap-x-2")[0]).toMatchObject({ utility: "gap-x", value: "2" });
    expect(parseClassString("min-w-0")[0]).toMatchObject({ utility: "min-w", value: "0" });
    expect(parseClassString("rounded-tl-lg")[0]).toMatchObject({ utility: "rounded-tl", value: "lg" });
    expect(parseClassString("border-t-red-500")[0]).toMatchObject({ utility: "border-t", value: "red-500" });
  });

  it("색상 이름 value의 하이픈을 유지한다", () => {
    expect(parseClassString("bg-blue-500")[0]).toMatchObject({ utility: "bg", value: "blue-500" });
    expect(parseClassString("text-primary-500")[0]).toMatchObject({ utility: "text", value: "primary-500" });
  });

  it("토큰 전체가 유틸리티 이름이면 value null이다", () => {
    expect(parseClassString("border-t")[0]).toMatchObject({ utility: "border-t", value: null });
    expect(parseClassString("gap-x")[0]).toMatchObject({ utility: "gap-x", value: null });
    expect(parseClassString("rounded-tl")[0]).toMatchObject({ utility: "rounded-tl", value: null });
  });

  it("접두만 있는 rounded는 value null이다", () => {
    expect(parseClassString("rounded")[0]).toMatchObject({ utility: "rounded", value: null });
  });

  it("공백·개행·탭 혼합 문자열을 토큰으로 나눈다", () => {
    const parsed = parseClassString("  flex\n\tp-4   md:p-8\r\n  text-[#fff] ");
    expect(parsed.map((p) => p.raw)).toEqual(["flex", "p-4", "md:p-8", "text-[#fff]"]);
  });

  it("빈 문자열은 빈 배열이다", () => {
    expect(parseClassString("")).toEqual([]);
    expect(parseClassString("  \n ")).toEqual([]);
  });

  it("대괄호 안의 콜론은 variant 구분자가 아니다", () => {
    expect(parseClassString("[&:hover]:p-4")[0]).toMatchObject({
      variants: ["[&:hover]"],
      utility: "p",
      value: "4",
    });
    expect(parseClassString("bg-[color:var(--c)]")[0]).toMatchObject({
      variants: [],
      utility: "bg",
      value: "color:var(--c)",
      arbitrary: true,
    });
  });

  it("음수 arbitrary 값을 인식한다", () => {
    expect(parseClassString("-mt-[4px]")[0]).toMatchObject({
      utility: "mt",
      value: "4px",
      arbitrary: true,
      negative: true,
    });
  });
});
