import { describe, expect, it } from "vitest";
import { DEFAULT_TOKEN_BUDGET, clipJson, clipMessage, estimateTokens, paginate, shrinkToBudget, toText, type Page } from "../src/budget.js";

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

describe("shrinkToBudget 재설계", () => {
  it("props[].values 400개: 상한 이하, props가 남고, omitted 키가 적고, 100ms 안", () => {
    const value = {
      name: "Wide",
      props: Array.from({ length: 400 }, (_, i) => ({
        name: `prop${i}`,
        type: "'alpha' | 'beta' | 'gamma' | 'delta'",
        required: false,
        values: ["alpha", "beta", "gamma", "delta"],
      })),
    };
    const t0 = performance.now();
    const out = shrinkToBudget(value, 1500);
    const ms = performance.now() - t0;
    expect(estimateTokens(toText(out))).toBeLessThanOrEqual(1500);
    expect((out.props as unknown[]).length).toBeGreaterThan(0);
    expect(out.truncated).toBe(true);
    expect(Object.keys(out.omitted ?? {}).length).toBeLessThanOrEqual(4);
    expect(ms).toBeLessThan(100);
  });

  it("형제 배열은 와일드카드 경로로 묶어 함께 줄인다", () => {
    const big = Array.from({ length: 400 }, (_, i) => `value-number-${i}`);
    const value = { props: [{ name: "a", values: big }, { name: "b", values: ["x", "y", "z"] }] };
    const out = shrinkToBudget(value, 600);
    expect(estimateTokens(toText(out))).toBeLessThanOrEqual(600);
    expect(out.omitted).toHaveProperty(["props.*.values"]);
    expect(out.omitted?.["props.*.values"]).toBeGreaterThan(100);
  });

  it("pin한 원소는 배열을 줄여도 남긴다", () => {
    const items = Array.from({ length: 100 }, (_, i) => ({ id: `item-${i}`, note: "some descriptive text here" }));
    const value = { options: items, keep: "item-97" };
    const out = shrinkToBudget(value, 300, { pin: (path, item) => path === "options" && (item as { id: string }).id === "item-97" });
    expect(estimateTokens(toText(out))).toBeLessThanOrEqual(300);
    expect((out.options as { id: string }[]).map((o) => o.id)).toContain("item-97");
    expect((out.options as unknown[]).length).toBeLessThan(100);
  });

  it("afterCut으로 줄인 뒤 종속 값을 정리할 수 있다", () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ id: `i${i}` }));
    const byId = Object.fromEntries(items.map((i) => [i.id, "x".repeat(60)]));
    const out = shrinkToBudget({ options: items, byId }, 400, {
      afterCut: (v) => {
        const ids = new Set((v.options as { id: string }[]).map((o) => o.id));
        for (const k of Object.keys(v.byId as object)) if (!ids.has(k)) delete (v.byId as Record<string, string>)[k];
      },
    });
    expect(estimateTokens(toText(out))).toBeLessThanOrEqual(400);
    expect(Object.keys(out.byId as object).length).toBe((out.options as unknown[]).length);
  });

  it("길이 1 배열은 다른 배열이 있으면 건드리지 않는다", () => {
    const value = { rows: [{ tags: Array.from({ length: 300 }, (_, i) => `tag-number-${i}`) }] };
    const out = shrinkToBudget(value, 500);
    expect((out.rows as unknown[]).length).toBe(1);
    expect(out.omitted?.["rows.0.tags"]).toBeGreaterThan(0);
  });

  it("최상위 배열은 받지 않는다", () => {
    expect(() => shrinkToBudget([1, 2, 3] as never, 10)).toThrow(/배열/);
  });
});

describe("paginate: 버전 있는 cursor·enrich", () => {
  const items = Array.from({ length: 300 }, (_, i) => ({ id: i, label: `item-number-${i}` }));

  it("nextCursor는 <offset>.<stamp>, 같은 stamp로 이어 받는다", () => {
    const first = paginate(items, undefined, 400, wrap, { stamp: "abc123" }) as { nextCursor: string; items: unknown[] };
    expect(first.nextCursor).toBe(`${first.items.length}.abc123`);
    const second = paginate(items, first.nextCursor, 400, wrap, { stamp: "abc123" }) as { items: { id: number }[] };
    expect(second.items[0]?.id).toBe(first.items.length);
  });

  it("stamp가 다르면 '데이터가 바뀜', 형식이 틀리면 '잘못된 cursor'", () => {
    expect(() => paginate(items, "3.old", 400, wrap, { stamp: "new" })).toThrow("데이터가 바뀜 — cursor 없이 다시");
    expect(() => paginate(items, "3", 400, wrap, { stamp: "new" })).toThrow(/잘못된 cursor/);
    expect(() => paginate(items, "999.new", 400, wrap, { stamp: "new" })).toThrow(/잘못된 cursor/);
  });

  it("enrich는 페이지에 실릴 원소 근처에만 부른다", () => {
    let calls = 0;
    const page = paginate(items, undefined, 400, wrap, {
      enrich: (item) => {
        calls += 1;
        return { ...item, label: `${item.label} + extra suggestion text` };
      },
    }) as { items: unknown[] };
    expect(page.items.length).toBeLessThan(300);
    expect(calls).toBeLessThanOrEqual(page.items.length * 2 + 5);
    expect(estimateTokens(toText(page))).toBeLessThanOrEqual(400);
  });
});

describe("clipJson", () => {
  it("상한 이하면 그대로, 넘으면 truncated:true 래퍼로 상한 이하", () => {
    expect(clipJson('{"a":1}', 100)).toBe('{"a":1}');
    const long = JSON.stringify({ text: "x".repeat(20_000) });
    const clipped = clipJson(long, 200);
    expect(estimateTokens(clipped)).toBeLessThanOrEqual(200);
    expect(JSON.parse(clipped)).toMatchObject({ truncated: true });
  });
});

describe("clipMessage", () => {
  it("긴 메시지를 상한 안으로 줄인다", () => {
    const out = clipMessage("가".repeat(5000), 100);
    expect(estimateTokens(out)).toBeLessThanOrEqual(100);
    expect(out.endsWith("…")).toBe(true);
    expect(clipMessage("짧음", 100)).toBe("짧음");
  });
});
