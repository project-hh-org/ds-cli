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
  });
});
