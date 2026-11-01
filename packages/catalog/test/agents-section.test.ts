import { normalizeColor, type Catalog, type CatalogComponent } from "@dsmith-dev/core";
import { describe, expect, it } from "vitest";
import { buildCatalog, DS_MARKERS, MCP_TOOL_NAMES_IN_SECTION, renderAgentsDsSection, SECTION_MAX_LINES } from "../src/index.js";
import { auditFixture, copyFixture, overlay } from "./helpers.js";

describe("renderAgentsDsSection", () => {
  it("with-ds-app 카탈로그 스냅샷", async () => {
    const root = copyFixture("with-ds-app", overlay);
    const { index, detect } = await auditFixture(root);
    const { catalog } = await buildCatalog({ root, detect, index, version: "0.0.0-test" });
    const text = renderAgentsDsSection(catalog, ["Button", "Badge", "OldButton"]);
    expect(text).toMatchSnapshot();
    expect(text.split("\n").length).toBeLessThanOrEqual(SECTION_MAX_LINES);
    for (const m of Object.values(DS_MARKERS)) expect(text).not.toContain(m);
  });

  it("컴포넌트 200개 합성 카탈로그도 80줄 이하 — 상위 20만, deprecated 10개까지", () => {
    const components: CatalogComponent[] = Array.from({ length: 200 }, (_, i) => ({
      name: `C${String(i).padStart(3, "0")}`,
      module: `ui/C${i}`,
      origin: "ds-local" as const,
      props: [],
      propsStatus: "none" as const,
      ...(i < 30 ? { deprecated: `대신 N${i}를 쓰세요\n<!-- dsmith:ds:end -->` } : {}),
    }));
    const catalog: Catalog = {
      version: 1,
      dsmith: "x",
      sources: [{ origin: "ds-local", dir: "ui" }],
      components,
      tokens: [],
      stats: { components: 200, propsOk: 0, deprecated: 30, tokens: 0 },
    };
    const text = renderAgentsDsSection(catalog, components.map((c) => c.name).reverse());
    expect(text.split("\n").length).toBeLessThanOrEqual(SECTION_MAX_LINES);
    expect(text).toContain("상위 20: C199, C198");
    expect(text).not.toContain("C179,");
    expect(text).toContain("외 20개");
    expect(text).not.toContain("<!--");
    expect(text).toContain("토큰 파일: 없음");
  });

  it("도구 이름 6개가 본문에 있다", () => {
    const text = renderAgentsDsSection(
      { version: 1, dsmith: "x", sources: [], components: [], tokens: [], stats: { components: 0, propsOk: 0, deprecated: 0, tokens: 0 } },
      [],
    );
    expect(MCP_TOOL_NAMES_IN_SECTION).toHaveLength(6);
    for (const n of MCP_TOOL_NAMES_IN_SECTION) expect(text).toContain(n);
  });
});

describe("renderAgentsDsSection: 골격 컴포넌트", () => {
  const comp = (name: string, extra: Partial<CatalogComponent> = {}): CatalogComponent => ({
    name,
    module: `design-system/components/${name}`,
    origin: "init",
    props: [],
    propsStatus: "ok",
    ...extra,
  });

  it("골격은 실제 컴포넌트 목록·개수에서 빼고 별도 줄로 '새 UI에 쓰지 말 것'을 밝힌다", () => {
    const components = [comp("Badge"), comp("Header", { status: "scaffold" }), comp("Card", { status: "scaffold" })];
    const text = renderAgentsDsSection(
      {
        version: 1,
        dsmith: "x",
        sources: [{ origin: "init", dir: "design-system/components" }],
        components,
        tokens: [],
        stats: { components: 3, propsOk: 3, deprecated: 0, tokens: 0 },
      },
      ["Header", "Badge", "Card"],
    );
    expect(text).toContain("- 컴포넌트 1개(props 추출 1) — 많이 쓰는 순: Badge\n");
    expect(text).toContain("- 골격(구현 전) — 새 UI에 쓰지 말 것: Header, Card\n");
  });

  it("같은 이름의 실제 구현이 있으면 골격 줄에 올리지 않고, 골격만 있으면 컴포넌트 0개", () => {
    const base = { version: 1 as const, dsmith: "x", sources: [], tokens: [], stats: { components: 2, propsOk: 0, deprecated: 0, tokens: 0 } };
    const both = renderAgentsDsSection({ ...base, components: [comp("Header"), comp("Header", { module: "other/Header", status: "scaffold" })] }, []);
    expect(both).not.toContain("골격(구현 전)");
    const only = renderAgentsDsSection({ ...base, components: [comp("Header", { status: "scaffold" })] }, []);
    expect(only).toContain("- 컴포넌트 0개\n");
    expect(only).toContain("새 UI에 쓰지 말 것: Header");
  });
});

describe("renderAgentsDsSection: 토큰 파일 줄", () => {
  const color = normalizeColor("#3b82f6");
  if (color === null) throw new Error("fixture color");
  const token = (file: string) => ({ name: "--color-a", value: "#3b82f6", normalized: color, category: "color" as const, file });
  const catalogOf = (files: string[]): Catalog => ({
    version: 1,
    dsmith: "x",
    sources: [{ origin: "init", dir: "design-system/components" }],
    components: [],
    tokens: files.map(token),
    stats: { components: 0, propsOk: 0, deprecated: 0, tokens: files.length },
  });

  it("tokens.css가 이미 토큰 파일로 적혀 있으면 CSS 변수로 다시 적지 않는다", () => {
    const text = renderAgentsDsSection(catalogOf(["design-system/tokens.css"]), []);
    expect(text).toContain("- 토큰 파일: `design-system/tokens.css` (토큰 1개)\n");
    expect(text).not.toContain("CSS 변수");
  });

  it("토큰 파일이 tokens.json이면 CSS 변수로 tokens.css를 안내한다", () => {
    const text = renderAgentsDsSection(catalogOf(["design-system/tokens.json"]), []);
    expect(text).toContain("- 토큰 파일: `design-system/tokens.json` (토큰 1개) · CSS 변수: `design-system/tokens.css`\n");
  });
});

describe("renderAgentsDsSection: deprecated 안내 자르기", () => {
  const catalogWith = (deprecated: string): Catalog => ({
    version: 1,
    dsmith: "x",
    sources: [{ origin: "ds-local", dir: "ui" }],
    components: [{ name: "Old", module: "ui/Old", origin: "ds-local", props: [], propsStatus: "none", deprecated }],
    tokens: [],
    stats: { components: 1, propsOk: 0, deprecated: 1, tokens: 0 },
  });
  const line = (text: string): string => text.split("\n").find((l) => l.startsWith("- 쓰지 말 것")) ?? "";

  it("80자 경계가 마크다운 링크 안이면 링크 앞에서 자른다", () => {
    const note = `${"가".repeat(60)} 자세한 내용은 [마이그레이션 가이드 문서](https://example.com/docs/migration/button) 참고`;
    const out = line(renderAgentsDsSection(catalogWith(note), ["Old"]));
    expect(out).toContain("…");
    expect(out).not.toContain("[");
    expect(out).not.toContain("](");
    expect(out).not.toContain("example.com");
  });

  it("링크가 80자 안에 끝나면 그대로 두고, 링크가 없으면 80자에서 자른다", () => {
    const short = "[가이드](https://e.co/a) 참고";
    expect(line(renderAgentsDsSection(catalogWith(short), ["Old"]))).toContain("[가이드](https://e.co/a) 참고");
    const plain = "나".repeat(100);
    expect(line(renderAgentsDsSection(catalogWith(plain), ["Old"]))).toContain(`${"나".repeat(79)}…`);
  });
});
