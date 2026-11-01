import fs from "node:fs";
import path from "node:path";
import { normalizeColor } from "@dsmith-dev/core";
import type { ExtractContext, Extractor, StyleUsage } from "@dsmith-dev/extractor-api";
import { describe, expect, it } from "vitest";
import { analyzeMigration, formatPlanSummary, planMigration, withFreshStyles, type MigratePlan } from "../src/index.js";
import { auditFixture, loadState, makeRepo } from "./helpers.js";

/** 실제 Extractor 6종으로 읽는 합성 레포. 토큰은 불투명 색·간격 몇 개 */
const TOKENS =
  ":root { --color-ink: #111827; --color-black: #000000; --color-white: #ffffff; --color-red: #ef4444; --space-2: 8px; --space-4: 16px; --text-sm: 14px; }\n";

async function planOf(files: Record<string, string>, opts: { close?: boolean; files?: string[] } = {}): Promise<{ root: string; plan: MigratePlan }> {
  const root = makeRepo({
    "package.json": JSON.stringify({ name: "x", dependencies: { react: "18", tailwindcss: "3.4.0", "@mui/material": "5", "styled-components": "6" } }),
    "styles/tokens.css": TOKENS,
    ...files,
  });
  await auditFixture(root);
  const plan = await planMigration({ root, ...(await loadState(root)), ...opts });
  return { root, plan };
}

const skippedSum = (p: MigratePlan): number => Object.values(p.skipped).reduce((n, v) => n + (v ?? 0), 0);
function expectInvariants(p: MigratePlan): void {
  expect(p.planned + skippedSum(p) + p.scope.outOfRange + p.close.length).toBe(p.scope.candidates);
  expect(p.scope.candidates + p.scope.far).toBe(p.scope.total);
}

describe("C1: 반투명 색은 토큰으로 바꾸지 않는다 (실제 Extractor)", () => {
  const cases: [string, Record<string, string>][] = [
    ["css rgba()", { "src/a.css": ".a { background-color: rgba(17, 24, 39, 0.5); }\n" }],
    ["css 8자리 hex", { "src/a.css": ".a { color: #11182780; }\n" }],
    ["css 4자리 hex", { "src/a.css": ".a { color: #fff8; }\n" }],
    ["css hsl(… / a)", { "src/a.css": ".a { border-color: hsl(221 39% 11% / 0.5); }\n" }],
    ["css 완전 투명 rgba(0,0,0,0)", { "src/a.css": ".a { color: rgba(0,0,0,0); }\n" }],
    ["css #0000", { "src/a.css": ".a { color: #0000; }\n" }],
    ["css rgb(0 0 0 / 0%)", { "src/a.css": ".a { color: rgb(0 0 0 / 0%); }\n" }],
    ["css background 단축 속성", { "src/a.css": ".a { background: rgba(17, 24, 39, 0.5); }\n" }],
    ["inline style rgba()", { "src/B.tsx": 'export const B = () => <div style={{ backgroundColor: "rgba(17,24,39,0.5)" }} />;\n' }],
    ["inline style 8자리 hex", { "src/B.tsx": 'export const B = () => <div style={{ color: "#11182780" }} />;\n' }],
    ["mui sx rgba()", { "src/B.tsx": 'import { Box } from "@mui/material";\nexport const B = () => <Box sx={{ bgcolor: "rgba(17,24,39,0.5)" }} />;\n' }],
    ["styled-components rgba()", { "src/B.tsx": 'import styled from "styled-components";\nexport const B = styled.div`\n  color: rgba(17, 24, 39, 0.5);\n`;\n' }],
    ["Tailwind text-[rgba(…)]", { "src/B.tsx": 'export const B = () => <p className="text-[rgba(0,0,0,0.1)]" />;\n' }],
    ["Tailwind bg-[#11182780]", { "src/B.tsx": 'export const B = () => <p className="bg-[#11182780]" />;\n' }],
  ];

  it.each(cases)("%s → translucent-color로 건너뜀, 파일 무변경", async (_name, files) => {
    const { plan } = await planOf(files);
    expect(plan.planned, JSON.stringify(plan.skippedItems)).toBe(0);
    expect(plan.skipped).toEqual({ "translucent-color": 1 });
    expect(plan.skippedItems[0]).toMatchObject({ reason: "translucent-color" });
    expect(plan.files).toEqual([]);
    expectInvariants(plan);
  });

  it("같은 파일의 불투명 색은 그대로 치환하고 반투명만 남긴다", async () => {
    const { plan } = await planOf({ "src/a.css": ".a { color: #111827; background-color: rgba(17, 24, 39, 0.5); border-color: #ffffff; }\n" });
    expect(plan.planned).toBe(2);
    expect(plan.skipped).toEqual({ "translucent-color": 1 });
    expect(plan.files[0]?.replacements.map((r) => r.raw)).toEqual(["#111827", "#ffffff"]);
    expectInvariants(plan);
  });

  it("alpha 1은 불투명이다 (rgba(…,1), #rrggbbff)", async () => {
    const { plan } = await planOf({ "src/a.css": ".a { color: rgba(17, 24, 39, 1); background-color: #111827ff; }\n" });
    expect(plan.planned).toBe(2);
    expect(plan.skipped).toEqual({});
  });
});

describe("방어 규칙 — 실제 Extractor로 확인한 결과 (M3)", () => {
  it("음수·0 간격은 분모에서 빠져(zeroOrNegative) 계획되지 않는다: inline -8, '-8px', 0", async () => {
    const { plan } = await planOf({
      "src/B.tsx": 'export const B = () => <div style={{ marginTop: -8, margin: "-8px", padding: 0 }} />;\n',
    });
    expect(plan.scope.zeroOrNegative).toBe(3);
    expect(plan.scope.total).toBe(0);
    expect(plan.planned).toBe(0);
    expect(plan.skipped).toEqual({});
    expectInvariants(plan);
  });

  it("음수 Tailwind 임의값(-mt-[8px])도 바꾸지 않는다", async () => {
    const { plan } = await planOf({ "src/B.tsx": 'export const B = () => <p className="-mt-[8px]" />;\n' });
    expect(plan.planned).toBe(0);
    expectInvariants(plan);
  });

  it("SCSS: 변수 정의·변수 참조·변수가 섞인 식은 치환하지 않는다", async () => {
    const { plan } = await planOf({
      "src/a.scss": "$g: #111827;\n$sp: 8px;\n.a { color: $g; padding: $sp + 8px; margin: 8px*$sp; gap: -$sp; }\n",
    });
    expect(plan.files.filter((f) => f.file === "src/a.scss")).toEqual([]);
    expect(plan.planned).toBe(0);
    for (const item of plan.skippedItems) expect(["multi-value", "scss-variable"]).toContain(item.reason);
    expectInvariants(plan);
  });

  it.each([
    ["css", { "src/E.css": ".e { padding: 8px 16px; }\n" }],
    ["inline style", { "src/E.tsx": 'export const E = () => <div style={{ padding: "8px 16px" }} />;\n' }],
    ["styled-components", { "src/E.tsx": 'import styled from "styled-components";\nexport const E = styled.div`\n  padding: 8px 16px;\n`;\n' }],
    ["mui sx", { "src/E.tsx": 'import { Box } from "@mui/material";\nexport const E = () => <Box sx={{ p: "8px 16px" }} />;\n' }],
    ["border-radius 4값", { "src/E.css": ".e { border-radius: 8px 8px 0 0; }\n" }],
  ])("다중 값 단축 속성(%s)은 치환하지 않는다", async (_name, files) => {
    const { plan } = await planOf(files);
    expect(plan.files).toEqual([]);
    expect(plan.planned).toBe(0);
    expectInvariants(plan);
  });
});

describe("UTF-8이 아닌 파일 (M1)", () => {
  it("계획 단계에서 binary-or-non-utf8로 건너뛰고 notes에 남긴다 — 적용 단계의 changed-since-plan이 아니다", async () => {
    const root = makeRepo({
      "package.json": JSON.stringify({ name: "x", dependencies: { react: "18" } }),
      "styles/tokens.css": TOKENS,
      "src/ok.css": ".ok { color: #111827; }\n",
    });
    // Latin-1 바이트(0xE9)가 든 주석 + 치환 대상 색
    fs.writeFileSync(path.join(root, "src/latin.css"), Buffer.concat([Buffer.from("/* caf"), Buffer.from([0xe9]), Buffer.from(" */\n.l { color: #111827; }\n")]));
    await auditFixture(root);
    const plan = await planMigration({ root, ...(await loadState(root)) });
    expect(plan.skipped).toEqual({ "binary-or-non-utf8": 1 });
    expect(plan.skippedItems[0]).toMatchObject({ file: "src/latin.css", reason: "binary-or-non-utf8" });
    expect(plan.files.map((f) => f.file)).toEqual(["src/ok.css"]);
    expect(plan.notes.some((n) => n.includes("src/latin.css") && n.includes("UTF-8"))).toBe(true);
    expectInvariants(plan);
  });
});

describe("낡은 인덱스 (I3)", () => {
  it("audit 뒤 고친 파일은 stale.changed에 오르고, fresh는 디스크에서 다시 읽은 줄 번호를 가진다", async () => {
    const root = makeRepo({
      "package.json": JSON.stringify({ name: "x", dependencies: { react: "18" } }),
      "styles/tokens.css": TOKENS,
      "src/a.css": ".a { color: #111827; }\n",
      "src/b.css": ".b { color: #ffffff; }\n",
    });
    await auditFixture(root);
    const state = await loadState(root);
    const clean = await analyzeMigration({ root, ...state });
    expect(clean.plan.stale).toEqual({ changed: [], added: [] });

    fs.writeFileSync(path.join(root, "src/a.css"), "/* 위에 한 줄 */\n.a { color: #111827; }\n");
    const { plan, fresh } = await analyzeMigration({ root, ...state });
    expect(plan.stale).toEqual({ changed: ["src/a.css"], added: [] });
    expect(fresh.files).toContain("src/a.css");
    expect(fresh.styles.find((u) => u.file === "src/a.css")?.line).toBe(2);
    expect(state.index.styles.find((u) => u.file === "src/a.css")?.line).toBe(1); // 인덱스는 그대로 낡았다
    const text = formatPlanSummary(plan, null);
    expect(text).toContain("인덱스가 오래됨: 1개 파일이 audit 이후 바뀜 — dsmith audit을 다시 실행하세요");
    // 계획의 패치는 디스크 기준이라 그대로 적용 가능하다
    expect(plan.files.find((f) => f.file === "src/a.css")?.replacements[0]?.line).toBe(2);
  });

  it("audit 뒤 생긴 새 파일도 읽어 계획하고 개수를 알린다", async () => {
    const root = makeRepo({
      "package.json": JSON.stringify({ name: "x", dependencies: { react: "18" } }),
      "styles/tokens.css": TOKENS,
      "src/a.css": ".a { color: #111827; }\n",
    });
    await auditFixture(root);
    const state = await loadState(root);
    await new Promise((r) => setTimeout(r, 20));
    fs.writeFileSync(path.join(root, "src/new.css"), ".n { color: #ffffff; }\n");
    fs.writeFileSync(path.join(root, "src/plain.ts"), "export const x = 1;\n"); // 스타일이 없는 새 파일은 알리지 않는다
    const { plan, fresh } = await analyzeMigration({ root, ...state });
    expect(plan.stale).toEqual({ changed: [], added: ["src/new.css"] });
    expect(plan.files.map((f) => f.file)).toEqual(["src/a.css", "src/new.css"]);
    expect(fresh.styles.some((u) => u.file === "src/new.css")).toBe(true);
    expect(formatPlanSummary(plan, null)).toContain("인덱스가 오래됨: 1개 파일이 audit 이후 바뀜(인덱스에 없던 새 파일 1개 포함) — dsmith audit을 다시 실행하세요");
  });

  it("withFreshStyles는 읽은 파일의 사용만 바꾸고 나머지는 유지한다", async () => {
    const root = makeRepo({
      "package.json": JSON.stringify({ name: "x", dependencies: { react: "18" } }),
      "styles/tokens.css": TOKENS,
      "src/a.css": ".a { color: #111827; }\n",
      "src/b.css": ".b { color: #ffffff; }\n",
    });
    await auditFixture(root);
    const state = await loadState(root);
    fs.rmSync(path.join(root, "src/b.css"));
    fs.writeFileSync(path.join(root, "src/a.css"), "\n\n.a { color: #111827; }\n");
    const { plan, fresh } = await analyzeMigration({ root, ...state });
    const merged = withFreshStyles(state.index, fresh);
    expect(merged.styles.filter((u) => u.file === "src/a.css").map((u) => u.line)).toEqual([3]);
    expect(merged.styles.some((u) => u.file === "src/b.css")).toBe(false); // 없어진 파일의 사용은 뺀다
    expect(merged.styles.some((u) => u.file === "styles/tokens.css")).toBe(true);
    expect(plan.notes.some((n) => n.startsWith("읽기 실패: src/b.css"))).toBe(true);
    expect(plan.notes.join("\n")).not.toContain(root); // 절대 경로를 남기지 않는다 (M7)
    expect(plan.stale.changed).toEqual(["src/a.css", "src/b.css"]);
  });
});

describe("--files (M8)", () => {
  it("일치하는 파일이 없으면 힌트를 notes에 남긴다", async () => {
    const { plan } = await planOf({ "src/a.css": ".a { color: #111827; }\n" }, { files: ["lib/**/*.css"] });
    expect(plan.files).toEqual([]);
    expect(plan.notes.some((n) => n.includes("--files 패턴(lib/**/*.css)과 일치하는 파일이 없음") && n.includes("root 기준 상대 경로"))).toBe(true);
  });

  it("앞의 ./는 떼고 맞춘다", async () => {
    const { plan } = await planOf({ "src/a.css": ".a { color: #111827; }\n" }, { files: ["./src/*.css"] });
    expect(plan.files.map((f) => f.file)).toEqual(["src/a.css"]);
    expect(plan.notes).toEqual([]);
  });
});

describe("계획 단계 검증은 남긴 묶음 전체를 다시 확인한다 (M6)", () => {
  it("치환을 하나씩은 통과해도 합치면 어긋나는 묶음은 모두 no-patch로 보류한다", async () => {
    const root = makeRepo({
      "package.json": JSON.stringify({ name: "x", dependencies: { react: "18" } }),
      "styles/tokens.css": ":root { --color-brand: #3b82f6; }\n",
      "src/C.tsx": 'export const C = () => <p style={{ color: "#3b82f6", background: "#3b82f6" }} />;\n',
    });
    await auditFixture(root);
    const { detect, index } = await loadState(root);
    const plan = await planMigration({ root, detect, index, files: ["src/C.tsx"], extractors: [fakeAtMostOneToken()] });
    expect(plan.planned).toBe(0);
    expect(plan.skipped).toEqual({ "no-patch": 2 });
    expect(plan.files).toEqual([]);
    expectInvariants(plan);
  });
});

/** 파일의 "#3b82f6" 리터럴마다 hardcoded 사용을 읽는다. 치환 뒤 token은 몇 개를 바꿨든 하나만 읽는다(합치면 개수가 어긋남) */
function fakeAtMostOneToken(): Extractor {
  const literal = '"#3b82f6"';
  const ref = '"var(--color-brand)"';
  const found = new WeakMap<StyleUsage, number>();
  return {
    name: "fake-min",
    files: ["**/*.tsx"],
    parses: "none",
    appliesTo: () => true,
    extract(ctx: ExtractContext): StyleUsage[] {
      const out: StyleUsage[] = [];
      for (let at = ctx.code.indexOf(literal); at >= 0; at = ctx.code.indexOf(literal, at + 1)) {
        const u: StyleUsage = { file: ctx.file, line: 1, column: at, property: "color", raw: "#3b82f6", normalized: normalizeColor("#3b82f6")!, source: "hardcoded", extractor: "fake-min" };
        found.set(u, at);
        out.push(u);
      }
      const t = ctx.code.indexOf(ref);
      if (t >= 0) out.push({ file: ctx.file, line: 1, column: t, property: "color", raw: "var(--color-brand)", normalized: { kind: "unknown" }, source: "token", extractor: "fake-min" });
      return out;
    },
    write(u, r) {
      const start = found.get(u);
      return start === undefined ? null : { file: u.file, start, end: start + literal.length, replacement: `"${r}"` };
    },
    tokenRef: () => "var(--color-brand)",
  };
}
