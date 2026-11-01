import type { Catalog, CatalogComponent } from "@dsmith-dev/core";
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
