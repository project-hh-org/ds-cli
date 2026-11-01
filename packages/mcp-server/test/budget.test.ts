import { describe, expect, it } from "vitest";
import { DEFAULT_TOKEN_BUDGET, estimateTokens, paginate, shrinkToBudget, toText, type Page } from "../src/budget.js";

const wrap = (page: Page<{ id: number; label: string }>): object => ({
  items: page.items,
  total: page.total,
  truncated: page.truncated,
  ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
});

describe("estimateTokens", () => {
  it("ASCII는 0.25, 그 외 1, 합을 올림", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("가나다")).toBe(3);
    expect(estimateTokens("")).toBe(0);
  });

  it("코드포인트 단위로 센다(서로게이트 쌍 = 1)", () => {
    expect(estimateTokens("😀")).toBe(1);
  });
});

describe("toText", () => {
  it("compact JSON", () => {
    expect(toText({ a: [1, 2] })).toBe('{"a":[1,2]}');
  });
});

describe("paginate", () => {
  const items = Array.from({ length: 1000 }, (_, i) => ({ id: i, label: `item-number-${i}` }));

  it("첫 페이지는 상한 이하이고 커서를 따라가면 1,000개를 정확히 한 번씩 본다", () => {
    const seen: number[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = paginate(items, cursor, DEFAULT_TOKEN_BUDGET, wrap) as {
        items: { id: number }[];
        total: number;
        truncated: boolean;
        nextCursor?: string;
      };
      expect(estimateTokens(toText(page))).toBeLessThanOrEqual(DEFAULT_TOKEN_BUDGET);
      expect(page.total).toBe(1000);
      expect(page.truncated).toBe(page.nextCursor !== undefined);
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== undefined);
    expect(pages).toBeGreaterThan(1);
    expect(seen).toEqual(items.map((i) => i.id));
  });

  it("상한 안에 다 들어가면 truncated false, nextCursor 없음", () => {
    const page = paginate(items.slice(0, 3), undefined, DEFAULT_TOKEN_BUDGET, wrap) as Record<string, unknown>;
    expect(page.truncated).toBe(false);
    expect(page).not.toHaveProperty("nextCursor");
  });

  it("아이템 하나가 상한보다 커도 1개는 담는다", () => {
    const big = [{ id: 1, label: "x".repeat(10_000) }, { id: 2, label: "y" }];
    const page = paginate(big, undefined, 100, wrap) as { items: unknown[]; truncated: boolean; nextCursor?: string };
    expect(page.items).toHaveLength(1);
    expect(page.truncated).toBe(true);
    expect(page.nextCursor).toBe("1");
  });

  it("빈 목록은 빈 페이지", () => {
    const page = paginate([], undefined, 100, wrap) as { items: unknown[]; total: number; truncated: boolean };
    expect(page).toMatchObject({ items: [], total: 0, truncated: false });
  });

  it("잘못된 cursor는 throw", () => {
    for (const bad of ["abc", "-1", "1.5", "1001", " 3"]) {
      expect(() => paginate(items, bad, 1500, wrap)).toThrow(/cursor/);
    }
  });

  it("끝 오프셋 cursor는 빈 페이지", () => {
    const page = paginate(items, "1000", 1500, wrap) as { items: unknown[]; truncated: boolean };
    expect(page.items).toEqual([]);
    expect(page.truncated).toBe(false);
  });
});

describe("shrinkToBudget", () => {
  it("상한 안이면 그대로(필드 추가 없음)", () => {
    const value = { a: [1, 2, 3] };
    expect(shrinkToBudget(value, 1500)).toEqual({ a: [1, 2, 3] });
  });

  it("500개 배열 객체는 상한 이하로 줄고 omitted 합 = 잘린 수", () => {
    const value = { name: "x", rows: Array.from({ length: 500 }, (_, i) => ({ id: i, text: `row text ${i}` })) };
    const out = shrinkToBudget(value, 600);
    expect(estimateTokens(toText(out))).toBeLessThanOrEqual(600);
    expect(out.truncated).toBe(true);
    const omitted = Object.values(out.omitted ?? {}).reduce((a, b) => a + b, 0);
    expect(out.omitted?.rows).toBe(omitted);
    expect((out.rows as unknown[]).length + omitted).toBe(500);
    expect(value.rows).toHaveLength(500); // 입력은 바뀌지 않는다
  });

  it("가장 긴 배열부터 줄이고 중첩 경로로 기록한다", () => {
    const value = {
      options: [
        { id: "a", files: Array.from({ length: 300 }, (_, i) => `src/some/long/path/file-${i}.tsx`) },
        { id: "b", files: ["x.tsx"] },
      ],
    };
    const out = shrinkToBudget(value, 500);
    expect(estimateTokens(toText(out))).toBeLessThanOrEqual(500);
    expect(out.omitted?.["options.0.files"]).toBeGreaterThan(0);
    expect(out.omitted).not.toHaveProperty("options.1.files");
  });

  it("배열이 더 없으면 그대로 truncated", () => {
    const out = shrinkToBudget({ text: "x".repeat(10_000) }, 100);
    expect(out.truncated).toBe(true);
    expect(out.omitted).toBeUndefined();
  });
});
