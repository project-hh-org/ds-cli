import { describe, expect, it } from "vitest";
import { DEFAULT_GUARD_POLICY, type Finding } from "@dsmith-dev/core";
import { COMMENT_MARKER, renderComment } from "../src/comment.js";
import type { GuardCiResult } from "../src/ci.js";

const hardcoded = (n: number, replacement: NonNullable<Finding["style"]>["replacement"] = null): Finding => ({
  rule: "no-hardcoded-style",
  file: "app/page.tsx",
  line: n,
  column: 0,
  message: "m",
  style: { property: "background-color", raw: "#3c83f7", extractor: "tailwind", category: "color", eligible: true, replacement },
});

type Input = Omit<GuardCiResult, "body" | "comment">;
const base = (over: Partial<Input> = {}): Input => ({
  base: "origin/main",
  mergeBase: "abc1234def5678",
  files: ["a", "b", "c", "d", "e"],
  newFindings: [],
  counts: { newHardcoded: 0, newReplaceable: 0, newNonDs: 0, newDeprecated: 0, removedHardcoded: 0 },
  staleSnapshot: [],
  parseFailed: [],
  policyChanged: false,
  exitCode: 0,
  ...over,
});

const component = (rule: "prefer-ds-component" | "no-deprecated-component", line: number, extra: Record<string, string> = {}): Finding => ({
  rule,
  file: "src/Page.tsx",
  line,
  column: 0,
  message: "m",
  component: { name: "OldButton", module: "@/legacy/Button", ...extra },
});

describe("renderComment", () => {
  it("브리프 형식 그대로: 마커·헤더·표·details", () => {
    const f = [hardcoded(12, { token: "--color-blue-500", value: "#3b82f6", confidence: "close", tokenIndex: 0 }), hardcoded(13), hardcoded(14)];
    const body = renderComment(
      base({ newFindings: f, counts: { newHardcoded: 3, newReplaceable: 1, newNonDs: 1, newDeprecated: 0, removedHardcoded: 0 }, exitCode: 1 }),
      DEFAULT_GUARD_POLICY,
    );
    expect(body).toBe(
      [
        "<!-- dsmith:guard -->",
        "### dsmith guard",
        "기준 `origin/main` (merge-base `abc1234`) · 검사한 변경 파일 5",
        "",
        "| 항목 | 신규 | 허용 |",
        "| --- | --- | --- |",
        "| 하드코딩 스타일 | 3 (토큰으로 바꿀 수 있음 1) | 0 |",
        "| DS 밖 컴포넌트 | 1 | – |",
        "| deprecated 컴포넌트 | 0 | 0 |",
        "",
        "<details><summary>신규 하드코딩 3건</summary>",
        "",
        "| 위치 | 속성 | 값 | 제안 토큰 |",
        "| --- | --- | --- | --- |",
        "| `app/page.tsx:12` | background-color | `#3c83f7` | `--color-blue-500` (close) |",
        "| `app/page.tsx:13` | background-color | `#3c83f7` | – |",
        "| `app/page.tsx:14` | background-color | `#3c83f7` | – |",
        "</details>",
        "",
      ].join("\n"),
    );
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
  });

  it("표는 50행까지, 넘치면 … 외 N건", () => {
    const f = Array.from({ length: 53 }, (_, i) => hardcoded(i + 1));
    const body = renderComment(base({ newFindings: f, counts: { newHardcoded: 53, newReplaceable: 0, newNonDs: 0, newDeprecated: 0, removedHardcoded: 0 } }), DEFAULT_GUARD_POLICY);
    expect(body.split("\n").filter((l) => l.startsWith("| `app/page.tsx:")).length).toBe(50);
    expect(body).toContain("… 외 3건");
    expect(body).toContain("신규 하드코딩 53건");
  });

  it("하드코딩 제거만 있으면 줄였습니다 문구, 신규가 있으면 쓰지 않는다", () => {
    const counts = { newHardcoded: 0, newReplaceable: 0, newNonDs: 0, newDeprecated: 0, removedHardcoded: 2 };
    expect(renderComment(base({ counts }), DEFAULT_GUARD_POLICY)).toContain("이 PR이 하드코딩 2건을 줄였습니다");
    const withNew = renderComment(
      base({ counts: { ...counts, newHardcoded: 1 }, newFindings: [hardcoded(1)] }),
      DEFAULT_GUARD_POLICY,
    );
    expect(withNew).not.toContain("줄였습니다");
  });

  it("낡은 스냅샷이면 맨 위에 경고, 허용 열은 정책 임계값", () => {
    const body = renderComment(base({ staleSnapshot: ["design-system/tokens.json"] }), {
      ...DEFAULT_GUARD_POLICY,
      failOn: { newHardcoded: 5, deprecated: 1 },
    });
    const lines = body.split("\n");
    expect(lines[0]).toBe(COMMENT_MARKER);
    expect(lines[1]).toContain("> ⚠ 토큰 파일이 guard.json보다 새것입니다 — dsmith guard init으로 갱신하세요");
    expect(body).toContain("| 하드코딩 스타일 | 0 (토큰으로 바꿀 수 있음 0) | 5 |");
    expect(body).toContain("| deprecated 컴포넌트 | 0 | 1 |");
  });

  it("DS 밖·deprecated 컴포넌트도 file:line 표를 낸다", () => {
    const body = renderComment(
      base({
        newFindings: [component("prefer-ds-component", 7, { preferModule: "@/ui" }), component("no-deprecated-component", 9, { deprecated: "Button으로 대체" })],
        counts: { newHardcoded: 0, newReplaceable: 0, newNonDs: 1, newDeprecated: 1, removedHardcoded: 0 },
        exitCode: 1,
      }),
      DEFAULT_GUARD_POLICY,
    );
    expect(body).toContain("<details><summary>신규 DS 밖 컴포넌트 1건</summary>");
    expect(body).toContain("| `src/Page.tsx:7` | OldButton | `@/legacy/Button` | @/ui 사용 |");
    expect(body).toContain("<details><summary>신규 deprecated 컴포넌트 1건</summary>");
    expect(body).toContain("| `src/Page.tsx:9` | OldButton | `@/legacy/Button` | Button으로 대체 |");
  });

  it("파싱 실패 파일과 정책 변경 문구를 적는다", () => {
    const body = renderComment(base({ parseFailed: ["a.tsx", "b.tsx"], policyChanged: true }), DEFAULT_GUARD_POLICY);
    expect(body).toContain("> ℹ 이 PR이 guard 정책을 바꿉니다 (기준: merge-base 정책 적용)");
    expect(body).toContain("파싱 실패 2건");
    expect(body).toContain("- `a.tsx`");
    expect(body).toContain("- `b.tsx`");
  });

  it("결정적이고 표의 | 는 이스케이프한다", () => {
    const f = hardcoded(1);
    f.style!.raw = "a|b";
    const input = base({ newFindings: [f], counts: { newHardcoded: 1, newReplaceable: 0, newNonDs: 0, newDeprecated: 0, removedHardcoded: 0 } });
    const a = renderComment(input, DEFAULT_GUARD_POLICY);
    expect(a).toBe(renderComment(input, DEFAULT_GUARD_POLICY));
    expect(a).toContain("`a\\|b`");
    expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});
