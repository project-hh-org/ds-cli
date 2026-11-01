import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { normalizeColor, writeCatalog, type Catalog, type CatalogComponent, type CatalogProp } from "@dsmith-dev/core";
import type { Client } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { estimateTokens } from "../src/budget.js";
import { connect, copyFixture, indexFixture, json, syntheticRoot, textOf, usageOf } from "./helpers.js";

const clients: Client[] = [];
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const prop = (name: string, type = "string", extra: Partial<CatalogProp> = {}): CatalogProp => ({ name, type, required: false, ...extra });

const BUTTON: CatalogComponent = {
  name: "Button",
  module: "components/ui/Button",
  origin: "ds-local",
  file: "components/ui/Button.tsx",
  props: [prop("children", "ReactNode"), prop("variant", '"primary" | "ghost"', { values: ["primary", "ghost"] })],
  propsStatus: "ok",
  description: "기본 버튼.",
  examples: [{ file: "components/ui/Button.stories.tsx", code: '<Button variant="primary">저장</Button>' }],
};
const BADGE: CatalogComponent = {
  name: "Badge",
  module: "components/ui/Badge",
  origin: "ds-local",
  file: "components/ui/Badge.tsx",
  props: [prop("tone", '"neutral" | "danger"', { values: ["neutral", "danger"] })],
  propsStatus: "ok",
  description: "상태 배지.",
};
const OLD_BUTTON: CatalogComponent = {
  name: "OldButton",
  module: "components/ui/OldButton",
  origin: "ds-local",
  file: "components/ui/OldButton.tsx",
  props: [],
  propsStatus: "none",
  deprecated: "Button을 쓰세요",
};

function catalogOf(components: CatalogComponent[], tokens: Catalog["tokens"] = []): Catalog {
  return {
    version: 1,
    dsmith: "0.0.0-test",
    sources: [{ origin: "ds-local", dir: "components/ui" }],
    components,
    tokens,
    stats: { components: components.length, propsOk: components.filter((c) => c.propsStatus === "ok").length, deprecated: 0, tokens: tokens.length },
  };
}

const primary = normalizeColor("#3b82f6");
if (primary === null) throw new Error("fixture color");
const TOKEN: Catalog["tokens"][number] = {
  name: "--color-primary",
  value: "#3b82f6",
  normalized: primary,
  category: "color",
  file: "design-system/tokens.json",
};

async function open(catalog: Catalog | null, log: (l: string) => void = () => {}): Promise<{ client: Client; root: string }> {
  const root = copyFixture("fixtures/with-ds-app");
  dirs.push(root);
  await indexFixture(root);
  if (catalog !== null) await writeCatalog(root, catalog);
  const client = await connect({ root, log });
  clients.push(client);
  return { client, root };
}

const call = (client: Client, name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });

describe("get_component: 카탈로그 우선", () => {
  it("Button → source catalog, 카탈로그 props·예시, 인덱스 사용 수, 다른 module", async () => {
    const { client } = await open(catalogOf([BUTTON, BADGE, OLD_BUTTON]));
    const out = json(await call(client, "get_component", { name: "Button" }));
    expect(out).toMatchObject({
      name: "Button",
      module: "components/ui/Button",
      source: "catalog",
      origin: "ds-local",
      propsSource: "type",
      description: "기본 버튼.",
      definitionFile: "components/ui/Button.tsx",
      variants: ["primary", "ghost"],
    });
    expect(out.props.map((p: { name: string }) => p.name)).toEqual(["children", "variant"]);
    expect(out.examples).toEqual(['<Button variant="primary">저장</Button>']);
    expect(out.usage.count).toBe(1);
    expect(out.otherModules).toEqual([{ module: "src/legacy/Button", isDs: false, decided: false }]);
  });

  it("인덱스 사용이 0인 카탈로그 항목은 deprecated와 usage {0, []}", async () => {
    const { client } = await open(catalogOf([BUTTON, OLD_BUTTON]));
    const out = json(await call(client, "get_component", { name: "OldButton" }));
    expect(out).toMatchObject({ source: "catalog", deprecated: "Button을 쓰세요", usage: { count: 0, files: [] }, propsSource: "usage" });
  });

  it("카탈로그에 없는 module을 지정하면 3a 경로(source index)", async () => {
    const { client } = await open(catalogOf([BUTTON]));
    const out = json(await call(client, "get_component", { name: "Button", module: "src/legacy/Button" }));
    expect(out.source).toBe("index");
    expect(out.origin).toBeUndefined();
  });

  it("카탈로그가 없으면 source index", async () => {
    const { client } = await open(null);
    expect(json(await call(client, "get_component", { name: "Button" })).source).toBe("index");
  });

  it("배럴 별칭(modules[])으로 불러 쓰는 사용 수를 조인한다", async () => {
    const root = await syntheticRoot([usageOf("Button", "src/ds", "src/a.tsx"), usageOf("Button", "src/ds", "src/b.tsx")]);
    dirs.push(root);
    await writeCatalog(root, catalogOf([{ ...BUTTON, module: "src/ds/Button", modules: ["src/ds"] }]));
    const client = await connect({ root });
    clients.push(client);
    const out = json(await call(client, "get_component", { name: "Button" }));
    expect(out).toMatchObject({ source: "catalog", module: "src/ds", usage: { count: 2 } });
  });
});

describe("search_component · resolve_token · resources", () => {
  it("사용 0회인 카탈로그 Badge가 검색에 나온다", async () => {
    const { client } = await open(catalogOf([BUTTON, BADGE]));
    const out = json(await call(client, "search_component", { intent: "badge" }));
    expect(out.results.map((m: { name: string }) => m.name)).toContain("Badge");
  });

  it("카탈로그 토큰은 resolve_token에서 source catalog", async () => {
    const { client } = await open(catalogOf([BUTTON], [TOKEN]));
    const byVar = json(await call(client, "resolve_token", { raw: "var(--color-primary)" }));
    expect(byVar).toMatchObject({ token: { name: "--color-primary" }, source: "catalog" });
    const byValue = json(await call(client, "resolve_token", { raw: "#3B82F6", property: "color" }));
    expect(byValue).toMatchObject({ token: { name: "--color-primary" }, source: "catalog", confidence: "high" });
  });

  it("components://list는 카탈로그가 있으면 source catalog", async () => {
    const { client } = await open(catalogOf([BUTTON, BADGE]));
    const res = await client.readResource({ uri: "components://list" });
    const body = JSON.parse((res.contents[0] as { text: string }).text);
    expect(body).toEqual({
      source: "catalog",
      components: [
        { name: "Button", module: "components/ui/Button" },
        { name: "Badge", module: "components/ui/Badge" },
      ],
    });
  });

  it("tokens://list는 source catalog를 허용한다", async () => {
    const { client } = await open(catalogOf([BUTTON], [TOKEN]));
    const res = await client.readResource({ uri: "tokens://list" });
    const body = JSON.parse((res.contents[0] as { text: string }).text);
    expect(body.names).toContain("--color-primary");
    expect(["catalog", "mixed"]).toContain(body.source);
  });
});

describe("catalog.json 다시 읽기", () => {
  it("파일이 바뀌면(mtime) 다음 호출이 새 내용을 쓴다", async () => {
    const { client, root } = await open(catalogOf([BUTTON]));
    expect(json(await call(client, "get_component", { name: "Button" })).description).toBe("기본 버튼.");
    await writeCatalog(root, catalogOf([{ ...BUTTON, description: "바뀐 설명." }, BADGE]));
    const file = path.join(root, ".dsmith", "catalog.json");
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(file, later, later);
    expect(json(await call(client, "get_component", { name: "Button" })).description).toBe("바뀐 설명.");
    expect(json(await call(client, "get_component", { name: "Badge" })).source).toBe("catalog");
  });

  it("깨진 catalog.json으로 바뀌면 이전 카탈로그를 유지하고 stderr에 남긴다", async () => {
    const logs: string[] = [];
    const { client, root } = await open(catalogOf([BUTTON]), (l) => logs.push(l));
    await call(client, "get_component", { name: "Button" });
    const file = path.join(root, ".dsmith", "catalog.json");
    fs.writeFileSync(file, "{ 깨짐");
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(file, later, later);
    const out = json(await call(client, "get_component", { name: "Button" }));
    expect(out).toMatchObject({ source: "catalog", description: "기본 버튼." });
    expect(logs.some((l) => l.includes("catalog.json"))).toBe(true);
  });
});

describe("응답 상한: 큰 카탈로그", () => {
  it("컴포넌트 1,000개·props 200개 카탈로그에서도 6개 도구 응답이 1500 토큰 이하", async () => {
    const big: CatalogComponent[] = Array.from({ length: 1000 }, (_, i) => ({
      name: `Widget${i}`,
      module: `src/ds/Widget${i}`,
      origin: "ds-local" as const,
      file: `src/ds/Widget${i}.tsx`,
      props: Array.from({ length: 200 }, (_, j) => prop(`prop${j}`, '"a" | "b" | "c"', { values: ["a", "b", "c"], description: "긴 설명 ".repeat(20) })),
      propsStatus: "ok" as const,
      description: "위젯 설명 ".repeat(30),
      examples: [{ file: "x.stories.tsx", code: "<Widget />".repeat(50) }],
    }));
    const manyTokens: Catalog["tokens"] = Array.from({ length: 500 }, (_, i) => ({ ...TOKEN, name: `--color-${i}` }));
    const { client } = await open(catalogOf([BUTTON, ...big], manyTokens));
    const results = await Promise.all([
      call(client, "get_component", { name: "Widget7" }),
      call(client, "search_component", { intent: "widget" }),
      call(client, "resolve_token", { raw: "#3b82f6" }),
      call(client, "lint_snippet", { code: 'export const A = () => <div style={{ color: "#3b82f6" }} />;', filename: "a.tsx" }),
      call(client, "list_decisions", {}),
      call(client, "explain_decision", { item: "Button" }),
    ]);
    for (const r of results) expect(estimateTokens(textOf(r)), textOf(r).slice(0, 60)).toBeLessThanOrEqual(1500);
    const resource = await client.readResource({ uri: "components://list" });
    expect(resource.contents.length).toBe(1);
  }, 20_000); // 병렬 실행 부하에서 5초를 넘기는 일이 있어 넉넉히 — 측정 대상은 토큰 수이지 시간이 아님
});

const sha = (file: string): string => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

describe("카탈로그 토큰 신선도", () => {
  const css = (hex: string): string => `:root {\n  --color-primary: ${hex};\n}\n`;
  const bump = (file: string, seconds: number): void => {
    const later = new Date(Date.now() + seconds * 1000);
    fs.utimesSync(file, later, later);
  };

  it("ai 뒤 토큰 파일이 바뀌면 카탈로그 토큰 대신 토큰 파일 값을 쓰고 stderr에 알린다", async () => {
    const logs: string[] = [];
    const root = copyFixture("fixtures/with-ds-app");
    dirs.push(root);
    await indexFixture(root);
    const file = path.join(root, "design-system.tokens.css");
    fs.writeFileSync(file, css("#3b82f6"));
    const catalog = catalogOf([BUTTON], [{ ...TOKEN, file: "design-system.tokens.css" }]);
    catalog.sources[0] = { ...catalog.sources[0], origin: "ds-local", tokenFiles: [{ file: "design-system.tokens.css", sha256: sha(file) }] };
    await writeCatalog(root, catalog);
    const client = await connect({ root, log: (l) => logs.push(l) });
    clients.push(client);

    expect(json(await call(client, "resolve_token", { raw: "#3b82f6", property: "color" }))).toMatchObject({ source: "catalog", confidence: "high" });
    expect(logs.some((l) => l.includes("토큰 파일이 카탈로그 생성 뒤에 바뀜"))).toBe(false);

    fs.writeFileSync(file, css("#ff0000"));
    bump(file, 5);
    const after = json(await call(client, "resolve_token", { raw: "#ff0000", property: "color" }));
    expect(after).toMatchObject({ token: { name: "--color-primary", value: "#ff0000" }, source: "token-file", confidence: "high" });
    expect(logs.some((l) => l.includes("design-system.tokens.css") && l.includes("dsmith ai"))).toBe(true);

    // 원래 내용으로 되돌리면 해시가 다시 맞아 카탈로그로 돌아간다
    fs.writeFileSync(file, css("#3b82f6"));
    bump(file, 10);
    expect(json(await call(client, "resolve_token", { raw: "#3b82f6", property: "color" }))).toMatchObject({ source: "catalog" });
  });

  it("토큰 파일이 지워져도(해시 불일치) 카탈로그를 쓰지 않는다", async () => {
    const root = copyFixture("fixtures/with-ds-app");
    dirs.push(root);
    await indexFixture(root);
    const file = path.join(root, "gone.tokens.css");
    fs.writeFileSync(file, css("#3b82f6"));
    const catalog = catalogOf([BUTTON], [{ ...TOKEN, file: "gone.tokens.css" }]);
    catalog.sources[0] = { ...catalog.sources[0], origin: "ds-local", tokenFiles: [{ file: "gone.tokens.css", sha256: sha(file) }] };
    await writeCatalog(root, catalog);
    fs.rmSync(file);
    const client = await connect({ root });
    clients.push(client);
    const res = await client.readResource({ uri: "tokens://list" });
    const body = JSON.parse((res.contents[0] as { text: string }).text);
    expect(body.names).not.toContain("--color-primary");
  });

  it("해시를 기록하지 않은 카탈로그는 검증하지 않고 그대로 쓴다", async () => {
    const { client } = await open(catalogOf([BUTTON], [TOKEN]));
    expect(json(await call(client, "resolve_token", { raw: "#3B82F6", property: "color" })).source).toBe("catalog");
  });
});

describe("골격(scaffold) 컴포넌트", () => {
  const SCAFFOLD_WIDGET: CatalogComponent = {
    name: "Widget",
    module: "design-system/components/Widget",
    origin: "init",
    file: "design-system/components/Widget.tsx",
    props: [],
    propsStatus: "none",
    status: "scaffold",
  };
  const REAL_WIDGET_GROUP: CatalogComponent = {
    name: "WidgetGroup",
    module: "components/ui/WidgetGroup",
    origin: "ds-local",
    file: "components/ui/WidgetGroup.tsx",
    props: [],
    propsStatus: "none",
  };
  const SCAFFOLD_BUTTON: CatalogComponent = { ...SCAFFOLD_WIDGET, name: "Button", module: "design-system/components/Button", file: "design-system/components/Button.tsx" };

  it("search_component: 골격은 점수가 더 높아도 실제 구현 뒤에 오고 status·why로 밝힌다", async () => {
    const { client } = await open(catalogOf([SCAFFOLD_WIDGET, REAL_WIDGET_GROUP]));
    const out = json(await call(client, "search_component", { intent: "widget" }));
    const names = out.results.map((m: { name: string }) => m.name);
    expect(names).toEqual(["WidgetGroup", "Widget"]);
    expect(out.results[1]).toMatchObject({ status: "scaffold" });
    expect(out.results[1].why).toContain("골격(구현 전)");
    expect(out.results[0].status).toBeUndefined();
  });

  it("get_component: status scaffold와 안내를 돌려준다", async () => {
    const { client } = await open(catalogOf([SCAFFOLD_WIDGET]));
    const out = json(await call(client, "get_component", { name: "Widget" }));
    expect(out).toMatchObject({ name: "Widget", source: "catalog", status: "scaffold" });
    expect(out.note).toContain("골격(구현 전)");
  });

  it("같은 이름이면 카탈로그에 있어도 골격보다 실제 구현을 고른다", async () => {
    const { client } = await open(catalogOf([BUTTON, SCAFFOLD_BUTTON]));
    const out = json(await call(client, "get_component", { name: "Button" }));
    expect(out).toMatchObject({ module: "components/ui/Button" });
    expect(out.status).toBeUndefined();
    expect(out.otherModules.map((o: { module: string }) => o.module)).toContain("design-system/components/Button");
  });
});
