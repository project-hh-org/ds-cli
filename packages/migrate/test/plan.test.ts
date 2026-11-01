import fs from "node:fs";
import path from "node:path";
import { normalizeColor, type Token } from "@dsmith-dev/core";
import type { ExtractContext, Extractor, StyleUsage } from "@dsmith-dev/extractor-api";
import { describe, expect, it } from "vitest";
import { planMigration, type MigratePlan } from "../src/index.js";
import { ALL, TOKENS_CSS, auditFixture, loadState, makeRepo, syntheticRepo } from "./helpers.js";

const skippedSum = (p: MigratePlan): number => Object.values(p.skipped).reduce((n, v) => n + (v ?? 0), 0);

function expectInvariants(p: MigratePlan): void {
  expect(p.planned + skippedSum(p) + p.scope.outOfRange + p.close.length).toBe(p.scope.candidates);
  expect(p.scope.candidates + p.scope.far).toBe(p.scope.total);
  expect(p.planned).toBe(p.files.reduce((n, f) => n + f.replacements.length, 0));
}

/** 합성 Extractor: 파일 안의 "#3b82f6" 리터럴을 hardcoded 색 사용 하나로 읽고, write는 [start+shift, end+shift)를 patch한다 */
function fakeExtractor(
  name: string,
  opts: { shift?: number; replacement?: (ref: string) => string; ref?: string | null; raw?: string; property?: StyleUsage["property"]; px?: number } = {},
): Extractor {
  const found = new WeakMap<StyleUsage, { start: number; end: number }>();
  const literal = '"#3b82f6"';
  return {
    name,
    files: ["**/*.tsx"],
    parses: "none",
    appliesTo: () => true,
    extract(ctx: ExtractContext): StyleUsage[] {
      const start = ctx.code.indexOf(literal);
      const tokenAt = ctx.code.indexOf('"var(--color-brand)"');
      if (start < 0 && tokenAt < 0) return [];
      if (start < 0) {
        // 치환 뒤: 토큰 참조로 읽는다
        return [{ file: ctx.file, line: 1, column: tokenAt, property: opts.property ?? "color", raw: "var(--color-brand)", normalized: { kind: "unknown" }, source: "token", extractor: name }];
      }
      const u: StyleUsage = {
        file: ctx.file,
        line: 1,
        column: start,
        property: opts.property ?? "color",
        raw: opts.raw ?? "#3b82f6",
        normalized: opts.px === undefined ? normalizeColor("#3b82f6")! : { kind: "length", px: opts.px },
        source: "hardcoded",
        extractor: name,
      };
      found.set(u, { start, end: start + literal.length });
      return [u];
    },
    write(u, ref) {
      const r = found.get(u);
      if (r === undefined) return null;
      const shift = opts.shift ?? 0;
      return { file: u.file, start: r.start + shift, end: r.end + shift, replacement: opts.replacement?.(ref) ?? `"${ref}"` };
    },
    tokenRef: () => (opts.ref === undefined ? "var(--color-brand)" : opts.ref),
  };
}

describe("planMigration", () => {
  it("불변식: 후보 = 계획 + 건너뜀, 후보 + 먼 값 = 전체, 계획은 파일을 쓰지 않는다", async () => {
    const root = syntheticRepo();
    await auditFixture(root);
    const state = await loadState(root);
    const before = fs.readFileSync(path.join(root, "src/a.css"), "utf-8");
    const plan = await planMigration({ root, ...state });
    expectInvariants(plan);
    expect(plan.scope.total).toBeGreaterThan(5);
    expect(plan.planned).toBeGreaterThan(0);
    expect(plan.tokens.source).toBe("token-file");
    expect(plan.files.map((f) => f.file)).toEqual([...plan.files.map((f) => f.file)].sort());
    for (const f of plan.files) expect(f.patches.length).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(root, "src/a.css"), "utf-8")).toBe(before);
    // width는 토큰 대상이 아니라 분모에 없다
    expect(plan.files.flatMap((f) => f.replacements).some((r) => r.property === "width")).toBe(false);
  });

  it("--category color는 색만 계획한다", async () => {
    const root = syntheticRepo();
    await auditFixture(root);
    const plan = await planMigration({ root, ...(await loadState(root)), category: "color" });
    expectInvariants(plan);
    expect(plan.planned).toBeGreaterThan(0);
    expect(plan.byCategory).toMatchObject({ spacing: 0, radius: 0, "font-size": 0 });
    expect(new Set(plan.files.flatMap((f) => f.replacements.map((r) => r.category)))).toEqual(new Set(["color"]));
  });

  it("close 매칭은 기본 계획에서 빠지고 plan.close에 남으며, close: true면 계획에 포함된다 (I4)", async () => {
    const root = syntheticRepo();
    await auditFixture(root);
    const state = await loadState(root);
    const base = await planMigration({ root, ...state });
    expectInvariants(base);
    expect(base.includeClose).toBe(false);
    expect(base.confidence.close).toBe(0);
    expect(base.close).toHaveLength(1); // margin: 7px → --space-2(8px)
    expect(base.close[0]).toMatchObject({ file: "src/a.css", raw: "7px", property: "margin", token: "--space-2", category: "spacing" });
    expect(base.close[0]!.distance).toBeGreaterThan(0);
    expect(base.files.flatMap((f) => f.replacements).some((r) => r.raw === "7px")).toBe(false);
    expect(base.skipped).toEqual({});

    const withClose = await planMigration({ root, ...state, close: true });
    expectInvariants(withClose);
    expect(withClose.includeClose).toBe(true);
    expect(withClose.close).toEqual([]);
    expect(withClose.confidence.close).toBe(1);
    expect(withClose.planned).toBe(base.planned + 1);
    expect(withClose.scope.candidates).toBe(base.scope.candidates);
  });

  it("files glob과 maxFiles", async () => {
    const root = syntheticRepo();
    await auditFixture(root);
    const state = await loadState(root);
    const globbed = await planMigration({ root, ...state, files: ["src/*.tsx"] });
    expectInvariants(globbed);
    expect(globbed.files.map((f) => f.file)).toEqual(["src/B.tsx", "src/C.tsx"]);
    expect(globbed.scope.files).toBe(2);

    const limited = await planMigration({ root, ...state, maxFiles: 1 });
    expectInvariants(limited);
    expect(limited.files.map((f) => f.file)).toEqual(["src/B.tsx"]);
    expect(limited.scope.outOfRange).toBeGreaterThan(0);
    expect(limited.notes).toContain("범위 제한으로 2개 파일 제외");
  });

  it("only components는 토큰 계획을 비우되 scope는 그대로 보고한다", async () => {
    const root = syntheticRepo();
    await auditFixture(root);
    const state = await loadState(root);
    const all = await planMigration({ root, ...state });
    const only = await planMigration({ root, ...state, only: "components" });
    expect(only.planned).toBe(0);
    expect(only.files).toEqual([]);
    expect(only.scope.candidates).toBe(all.scope.candidates);
    expectInvariants(only);
  });

  it("토큰이 없으면 init 안내 에러", async () => {
    const root = makeRepo({ "package.json": "{}", "src/a.css": ".a { color: #fff; }\n" });
    await auditFixture(root);
    await expect(planMigration({ root, ...(await loadState(root)) })).rejects.toThrow("먼저 `dsmith init`");
  });

  it("init 산출 디렉터리 아래 파일은 치환 대상이 아니다", async () => {
    const root = syntheticRepo({
      "design-system/tokens.json": "{}",
      "design-system/tokens.ts": 'export const c = { style: { color: "#3b82f6" } };\n',
      "design-system/Foo.tsx": 'export const F = () => <i style={{ color: "#3b82f6" }} />;\n',
    });
    await auditFixture(root);
    const plan = await planMigration({ root, ...(await loadState(root)) });
    expect(plan.files.some((f) => f.file.startsWith("design-system/"))).toBe(false);
    expectInvariants(plan);
  });

  it("CSS 변수가 아닌 카탈로그 토큰은 no-token-ref", async () => {
    const root = makeRepo({
      "package.json": JSON.stringify({ name: "x", dependencies: { react: "18" } }),
      "src/theme.ts": "export const colors = { brand: '#3b82f6' };\n",
      "src/B.tsx": 'export const B = () => <div style={{ color: "#3b82f6" }} />;\n',
    });
    await auditFixture(root);
    const { createHash } = await import("node:crypto");
    const sha = createHash("sha256").update(fs.readFileSync(path.join(root, "src/theme.ts"))).digest("hex");
    const token: Token & { file: string } = {
      name: "colors.brand",
      value: "#3b82f6",
      normalized: normalizeColor("#3b82f6")!,
      category: "color",
      file: "src/theme.ts",
    };
    fs.mkdirSync(path.join(root, ".dsmith"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".dsmith/catalog.json"),
      JSON.stringify({
        version: 1,
        dsmith: "0.0.0",
        sources: [{ origin: "ds-local", tokenFiles: [{ file: "src/theme.ts", sha256: sha }] }],
        components: [],
        tokens: [token],
        stats: { components: 0, propsOk: 0, deprecated: 0, tokens: 1 },
      }),
    );
    const plan = await planMigration({ root, ...(await loadState(root)) });
    expect(plan.tokens.source).toBe("catalog");
    expect(plan.scope.candidates).toBe(1);
    expect(plan.planned).toBe(0);
    expect(plan.skipped).toEqual({ "no-token-ref": 1 });
    expect(plan.skippedItems[0]).toMatchObject({ file: "src/B.tsx", reason: "no-token-ref", token: "colors.brand" });
    expectInvariants(plan);
  });

  it("tokenRef가 null이거나 write가 null이면 건너뛰고, 구간이 겹치면 둘 다 overlap", async () => {
    const root = syntheticRepo();
    await auditFixture(root);
    const { detect, index } = await loadState(root);
    const overlap = await planMigration({
      root,
      detect,
      index,
      extractors: [fakeExtractor("fake-a"), fakeExtractor("fake-b", { shift: 1 })],
      files: ["src/C.tsx"],
    });
    expectInvariants(overlap);
    expect(overlap.skipped).toEqual({ overlap: 2 });
    expect(overlap.planned).toBe(0);
    expect(overlap.files).toEqual([]);

    // 같은 구간·같은 치환은 하나의 패치로 합쳐지고 계획은 둘 다 남는다
    const same = await planMigration({
      root,
      detect,
      index,
      extractors: [fakeExtractor("fake-a"), fakeExtractor("fake-b")],
      files: ["src/C.tsx"],
    });
    expectInvariants(same);
    expect(same.planned).toBe(2);
    expect(same.files[0]?.patches).toHaveLength(1);

    const none = await planMigration({ root, detect, index, extractors: [fakeExtractor("fake-a", { ref: null })], files: ["src/C.tsx"] });
    expect(none.skipped).toEqual({ "no-token-ref": 1 });
    expectInvariants(none);
  });

  it("치환 뒤 다시 읽어 토큰으로 확인되지 않는 사용은 계획 단계에서 no-patch로 보류한다", async () => {
    const root = syntheticRepo();
    await auditFixture(root);
    const { detect, index } = await loadState(root);
    const plan = await planMigration({
      root, detect, index, files: ["src/C.tsx"],
      extractors: [fakeExtractor("fake-bad", { replacement: () => '"#3b82f7"' })],
    });
    expect(plan.planned).toBe(0);
    expect(plan.skipped).toEqual({ "no-patch": 1 });
    expect(plan.notes.some((n) => n.startsWith("1건은 치환 뒤 다시 읽어도 토큰으로 확인되지 않아 건너뜀"))).toBe(true);
    expectInvariants(plan);
  });


  describe("방어 규칙 (사유 코드로 보고)", () => {
    const tokens = `${TOKENS_CSS}:root { --radius-none: 0px; }\n`;

    it("negative-value: 음수 값은 Tailwind 외 Extractor에서 건너뛴다", async () => {
      const root = syntheticRepo({ "styles/tokens.css": tokens });
      await auditFixture(root);
      const { detect, index } = await loadState(root);
      const run = (name: string) =>
        planMigration({ root, detect, index, extractors: [fakeExtractor(name, { raw: "-4px", property: "border-radius", px: 4 })], files: ["src/C.tsx"] });
      const plan = await run("fake-neg");
      expect(plan.skipped).toEqual({ "negative-value": 1 });
      expectInvariants(plan);
      expect((await run("tailwind")).planned).toBe(1); // Tailwind만 절대값 매칭 허용
    });

    it("zero-value: 0 값은 건너뛴다", async () => {
      const root = syntheticRepo({ "styles/tokens.css": tokens });
      await auditFixture(root);
      const { detect, index } = await loadState(root);
      const plan = await planMigration({
        root, detect, index, files: ["src/C.tsx"],
        extractors: [fakeExtractor("fake-zero", { raw: "0", property: "border-radius", px: 0 })],
      });
      expect(plan.skipped).toEqual({ "zero-value": 1 });
      expectInvariants(plan);
    });

    it("scss-variable: 변수 피연산자가 섞인 값은 건너뛴다", async () => {
      const root = syntheticRepo();
      await auditFixture(root);
      const { detect, index } = await loadState(root);
      const plan = await planMigration({
        root, detect, index, files: ["src/C.tsx"],
        extractors: [fakeExtractor("fake-scss", { raw: "8px*$s", property: "padding", px: 8 })],
      });
      expect(plan.skipped).toEqual({ "scss-variable": 1 });
      expectInvariants(plan);
    });

    it("multi-value: 다중 값 단축 속성(padding: 8px 12px)은 건너뛴다", async () => {
      const root = syntheticRepo({ "src/E.css": ".e { padding: 8px 12px; }\n.f { padding: 8px; }\n" });
      await auditFixture(root);
      const plan = await planMigration({ root, ...(await loadState(root)), files: ["src/E.css"] });
      expect(plan.skipped).toEqual({ "multi-value": 1 });
      expect(plan.skippedItems[0]).toMatchObject({ line: 1, raw: "8px", reason: "multi-value" });
      expect(plan.planned).toBe(1); // 단일 값 padding: 8px은 치환
      expectInvariants(plan);
    });
  });

  describe("plan.tokens.loaded — 토큰 스타일시트 로드 여부 (I1)", () => {
    const NOTE = "토큰 스타일시트가 로드되지 않음: design-system/tokens.css를 전역 엔트리(예: app/layout.tsx, src/main.tsx, globals.css)에서 import하세요 — 치환된 var()가 비어 보입니다";
    const initRepo = (extra: Record<string, string> = {}): string =>
      makeRepo({
        "package.json": JSON.stringify({ name: "x", dependencies: { react: "18" } }),
        "design-system/tokens.json": "{}\n",
        "design-system/tokens.css": TOKENS_CSS,
        "app/layout.tsx": 'import "./globals.css";\nexport default function L() { return <div style={{ color: "#3b82f6" }} />; }\n',
        "app/globals.css": "body { padding: 16px; }\n",
        ...extra,
      });

    it("아무 파일도 tokens.css를 import하지 않으면 loaded false·노트 한 줄, 적용은 막지 않는다", async () => {
      const root = initRepo();
      await auditFixture(root);
      const plan = await planMigration({ root, ...(await loadState(root)) });
      expect(plan.tokens.loaded).toEqual({ css: false, evidence: null });
      expect(plan.notes.filter((n) => n.startsWith("토큰 스타일시트가 로드되지 않음"))).toEqual([NOTE]);
      expect(plan.planned).toBeGreaterThan(0);
    });

    it("app/layout.tsx가 import하면 loaded true·evidence·노트 없음", async () => {
      const root = initRepo({
        "app/layout.tsx": 'import "./globals.css";\nimport "../design-system/tokens.css";\nexport default function L() { return <div style={{ color: "#3b82f6" }} />; }\n',
      });
      await auditFixture(root);
      const plan = await planMigration({ root, ...(await loadState(root)) });
      expect(plan.tokens.loaded).toEqual({ css: true, evidence: "app/layout.tsx" });
      expect(plan.notes.some((n) => n.includes("토큰 스타일시트"))).toBe(false);
    });

    it("globals.css의 @import도 인정한다", async () => {
      const root = initRepo({ "app/globals.css": '@import "../design-system/tokens.css";\nbody { padding: 16px; }\n' });
      await auditFixture(root);
      const plan = await planMigration({ root, ...(await loadState(root)) });
      expect(plan.tokens.loaded).toEqual({ css: true, evidence: "app/globals.css" });
    });

    it("init 디렉터리가 없는(사용자 토큰 파일) 레포는 확인 대상이 아니라 loaded true·노트 없음", async () => {
      const root = syntheticRepo();
      await auditFixture(root);
      const plan = await planMigration({ root, ...(await loadState(root)) });
      expect(plan.tokens.loaded).toEqual({ css: true, evidence: null });
      expect(plan.notes).toEqual([]);
    });
  });

  it("Tailwind 프리셋이 없으면 notes 없이 계획한다 (연결 판정은 readTailwindPreset)", async () => {
    const root = syntheticRepo();
    await auditFixture(root);
    const plan = await planMigration({ root, ...(await loadState(root)), extractors: ALL });
    expect(plan.preset).toBeNull();
    expect(plan.notes).toEqual([]);
  });
});
