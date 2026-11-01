import fs from "node:fs";
import path from "node:path";
import type { ComponentUsage, Index } from "@dsmith-dev/core";
import type { Client } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { estimateTokens } from "../src/budget.js";
import { WITH_DS_TOKENS_CSS, connect, copyFixture, indexFixture, json, syntheticRoot, textOf, usageOf } from "./helpers.js";

const clients: Client[] = [];
const dirs: string[] = [];

async function open(
  rel: string,
  overlay?: Record<string, string>,
  extra: Partial<Omit<Parameters<typeof connect>[0], "root">> = {},
): Promise<{ client: Client; root: string }> {
  const root = copyFixture(rel, overlay);
  dirs.push(root);
  await indexFixture(root);
  const client = await connect({ root, git: false, ...extra });
  clients.push(client);
  return { client, root };
}

async function openSynthetic(components: ComponentUsage[], opts: { mkdirs?: string[] } = {}): Promise<{ client: Client; root: string }> {
  const root = await syntheticRoot(components, opts);
  dirs.push(root);
  const client = await connect({ root, git: false });
  clients.push(client);
  return { client, root };
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const call = (client: Client, name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });
const withDs = () => open("fixtures/with-ds-app", { "components/ui/tokens.css": WITH_DS_TOKENS_CSS });
const future = (file: string): void => {
  const t = new Date(Date.now() + 5000 + Math.floor(Math.random() * 1000));
  fs.utimesSync(file, t, t);
};

describe("입력 상한과 마지막 방어선", () => {
  it("50k 공백 raw는 거절되고 응답은 작다", async () => {
    const { client } = await withDs();
    const res = await call(client, "resolve_token", { raw: " ".repeat(50_000) });
    expect(res.isError).toBe(true);
    expect(estimateTokens(textOf(res))).toBeLessThanOrEqual(1500);
  });

  it.each([
    ["resolve_token", { raw: "x".repeat(201) }],
    ["resolve_token", { raw: "#fff", property: "p".repeat(65) }],
    ["search_component", { intent: "x".repeat(201) }],
    ["get_component", { name: "x".repeat(201) }],
    ["get_component", { name: "Button", module: "m".repeat(201) }],
    ["explain_decision", { item: "x".repeat(201) }],
  ])("%s 입력이 길면 isError", async (name, args) => {
    const { client } = await withDs();
    expect((await call(client, name, args)).isError).toBe(true);
  });

  it("raw는 다듬어서 되돌려 주고, 해석 오류 메시지의 raw는 80자로 자른다", async () => {
    const { client } = await withDs();
    const out = json(await call(client, "resolve_token", { raw: "  #3B82F6  ", property: "color" }));
    expect(out.input).toEqual({ raw: "#3B82F6", property: "color" });
    const bad = await call(client, "resolve_token", { raw: "z".repeat(150) });
    expect(bad.isError).toBe(true);
    expect(textOf(bad).length).toBeLessThan(120);
    expect(textOf(bad)).toContain("…");
  });

  it("어떤 도구든 응답이 상한을 넘으면 잘라서 truncated:true로 보낸다", async () => {
    const { client } = await open("fixtures/with-ds-app", { "components/ui/tokens.css": WITH_DS_TOKENS_CSS }, { tokenBudget: 40 });
    const res = await call(client, "resolve_token", { raw: "#3B82F6" });
    expect(estimateTokens(textOf(res))).toBeLessThanOrEqual(40);
    expect(json(res).truncated).toBe(true);
    const err = await call(client, "resolve_token", { raw: "z".repeat(150) });
    expect(estimateTokens(textOf(err))).toBeLessThanOrEqual(40);
  });

  it("도구 설명이 거리 단위와 신뢰도 기준을 밝힌다", async () => {
    const { client } = await withDs();
    const { tools } = await client.listTools();
    const d = tools.find((t) => t.name === "resolve_token")?.description ?? "";
    expect(d).toContain("ΔE");
    expect(d).toContain("px");
    expect(d).toContain("0.005");
  });
});

describe("explain_decision 축약", () => {
  it("옵션 120개에서도 추천 옵션(DS 모듈)을 남기고 옵션별 맵을 정리한다", async () => {
    const comps = Array.from({ length: 119 }, (_, i) =>
      usageOf("Card", `packages/design-system/src/cards/Card${i}`, `src/pages/Page${i}.tsx`, ["title", "footer"]),
    );
    comps.push(usageOf("Card", "src/components/ui/Card", "src/pages/Home.tsx", ["title"]));
    const { client } = await openSynthetic(comps, { mkdirs: ["src/components/ui"] });
    const res = await call(client, "explain_decision", { item: "Card" });
    const card = json(res);
    expect(estimateTokens(textOf(res))).toBeLessThanOrEqual(1500);
    expect(card.recommendation.optionId).toBe("src/components/ui/Card");
    const ids: string[] = card.options.map((o: { id: string }) => o.id);
    expect(ids).toContain("src/components/ui/Card");
    for (const key of Object.keys(card.impact.byOption)) expect(ids).toContain(key);
    for (const d of card.differences) for (const key of Object.keys(d.byOption)) expect(ids).toContain(key);
    expect(Object.keys(card.omitted ?? {}).length).toBeLessThan(15);
  });
});

describe("lint_snippet 파일 이름", () => {
  const code = 'export const A = () => <div className="text-[#3B82F6]" />';
  const lint = (client: Client, args: Record<string, unknown>) => call(client, "lint_snippet", args);

  it.each(["../x.tsx", "src/.hidden/x.tsx", "./src/../x.tsx", "src\\a\\x.tsx", "/abs/elsewhere/x.tsx"])("%s 도 검사한다", async (filename) => {
    const { client } = await withDs();
    const out = json(await lint(client, { code, filename }));
    expect(out.violations).toHaveLength(1);
    expect(out.extractorsRun).toContain("tailwind");
  });

  it("어느 Extractor에도 안 맞는 파일은 isError", async () => {
    const { client } = await withDs();
    const res = await lint(client, { code, filename: "README.md" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toBe("검사할 Extractor 없음: README.md (지원: .tsx/.jsx/.ts/.js/.css/.scss)");
  });

  it("glob은 맞지만 appliesTo가 거짓이면 빈 결과(오류 아님)", async () => {
    const { client } = await withDs();
    const out = json(await lint(client, { code: "export const a = 1;", filename: "a.tsx" }));
    expect(out.violations).toEqual([]);
    expect(out.summary).toEqual({ hardcoded: 0, token: 0, dynamic: 0 });
  });
});

describe("resolve_token 보강", () => {
  it("var(--known)은 그 토큰으로 거리 0, 모르는 var는 오류", async () => {
    const { client } = await withDs();
    const out = json(await call(client, "resolve_token", { raw: "var(--color-primary)" }));
    expect(out).toMatchObject({ token: { name: "--color-primary", value: "#3b82f6" }, distance: 0, confidence: "high", source: "token-file" });
    expect((await call(client, "resolve_token", { raw: "var(--nope)" })).isError).toBe(true);
    const withFallback = json(await call(client, "resolve_token", { raw: "var(--color-text, #000)" }));
    expect(withFallback.token.name).toBe("--color-text");
  });

  it("값 종류와 property가 안 맞으면 hint를 준다", async () => {
    const { client } = await withDs();
    const out = json(await call(client, "resolve_token", { raw: "#3B82F6", property: "padding" }));
    expect(out).not.toHaveProperty("token");
    expect(out.hint).toContain("padding");
    const reverse = json(await call(client, "resolve_token", { raw: "8px", property: "color" }));
    expect(reverse.hint).toContain("color");
    expect(json(await call(client, "resolve_token", { raw: "8px", property: "padding" }))).not.toHaveProperty("hint");
  });

  it("alternatives가 토큰별 source를 싣는다", async () => {
    const { client } = await withDs();
    const out = json(await call(client, "resolve_token", { raw: "#3B82F6" }));
    expect(out.alternatives[0]).toMatchObject({ name: "--color-text", source: "token-file" });
  });
});

describe("tokens://list 출처", () => {
  it("토큰 파일에 색만 있으면 mixed이고 제안 토큰 이름을 따로 알린다", async () => {
    const pads = Array.from({ length: 6 }, (_, i) => `export const P${i} = () => <div style={{ padding: 16, margin: 8 }} />;`).join("\n");
    const { client } = await open("fixtures/with-ds-app", {
      "components/ui/tokens.css": ":root {\n  --color-primary: #3b82f6;\n}\n",
      "src/extra/Pads.tsx": pads,
    });
    const { contents } = await client.readResource({ uri: "tokens://list" });
    const body = JSON.parse((contents[0] as { text: string }).text);
    expect(body.source).toBe("mixed");
    expect(body.names).toContain("--color-primary");
    expect(body.proposals.length).toBeGreaterThan(0);
    expect(body.proposals).not.toContain("--color-primary");
    const spacing = json(await call(client, "resolve_token", { raw: "16px", property: "padding" }));
    expect(spacing.source).toBe("proposal");
  });
});

describe("search_component matched · 버전 cursor", () => {
  const many = (): ComponentUsage[] =>
    Array.from({ length: 80 }, (_, i) =>
      usageOf(`Button${i}`, `packages/design-system/src/components/buttons/Button${i}`, `src/pages/Page${i}.tsx`, ["buttonVariant", "buttonSize"]),
    );

  it("matched는 limit 전 일치 수", async () => {
    const { client } = await openSynthetic(many());
    const out = json(await call(client, "search_component", { intent: "button", limit: 5 }));
    expect(out.results).toHaveLength(5);
    expect(out.matched).toBe(80);
    expect(out.total).toBe(5);
  });

  it("데이터가 바뀌면 이전 cursor는 isError", async () => {
    const { client, root } = await openSynthetic(many());
    const first = json(await call(client, "search_component", { intent: "button", limit: 50 }));
    expect(first.nextCursor).toMatch(/^\d+\.[0-9a-f]{8}$/);
    const same = await call(client, "search_component", { intent: "button", limit: 50, cursor: first.nextCursor });
    expect(same.isError).not.toBe(true);

    const file = path.join(root, ".dsmith", "index.json");
    const index = JSON.parse(fs.readFileSync(file, "utf-8")) as Index;
    index.components.push(usageOf("ButtonZ", "src/z", "src/z.tsx"));
    fs.writeFileSync(file, JSON.stringify(index));
    future(file);
    const stale = await call(client, "search_component", { intent: "button", limit: 50, cursor: first.nextCursor });
    expect(stale.isError).toBe(true);
    expect(textOf(stale)).toBe("데이터가 바뀜 — cursor 없이 다시");
  });

  it("다른 인자로 받은 cursor도 거절한다(search·lint·list)", async () => {
    const { client } = await openSynthetic(many());
    const first = json(await call(client, "search_component", { intent: "button", limit: 50 }));
    const other = await call(client, "search_component", { intent: "buttons", limit: 50, cursor: first.nextCursor });
    expect(other.isError).toBe(true);
    const list = await call(client, "list_decisions", { cursor: first.nextCursor });
    expect(list.isError).toBe(true);
    const lint = await call(client, "lint_snippet", { code: "export const a = 1;", cursor: first.nextCursor });
    expect(lint.isError).toBe(true);
  });
});

describe("다시 읽기 실패", () => {
  it("index.json이 깨지면 마지막 정상 데이터를 유지하고 로그를 남기며, 고치면 다시 읽는다", async () => {
    const logs: string[] = [];
    const { client, root } = await open("examples/legacy-demo", undefined, { log: (l: string) => void logs.push(l) });
    const before = json(await call(client, "search_component", { intent: "table" }));
    const file = path.join(root, ".dsmith", "index.json");
    const good = fs.readFileSync(file, "utf-8");

    fs.writeFileSync(file, "{ not json");
    future(file);
    const during = json(await call(client, "search_component", { intent: "table" }));
    expect(during.results).toEqual(before.results);
    expect(logs.join("\n")).toContain("index.json");

    const index = JSON.parse(good) as Index;
    index.components.push(usageOf("Tablezzz", "src/tablezzz", "src/t.tsx"));
    fs.writeFileSync(file, JSON.stringify(index));
    future(file);
    const after = json(await call(client, "search_component", { intent: "tablezzz" }));
    expect(after.results.map((r: { name: string }) => r.name)).toEqual(["Tablezzz"]);
  });

  it("처음부터 깨져 있으면 한국어 오류로 알린다", async () => {
    const root = copyFixture("fixtures/with-ds-app");
    dirs.push(root);
    await indexFixture(root);
    fs.writeFileSync(path.join(root, ".dsmith", "index.json"), "{ not json");
    const client = await connect({ root, git: false });
    clients.push(client);
    const res = await call(client, "resolve_token", { raw: "#fff" });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toMatch(/^\.dsmith\/index\.json을 읽을 수 없음: /);
  });
});

describe("lint 제안은 페이지에 실리는 위반에만 붙는다", () => {
  it("큰 스니펫도 응답은 상한 안이고 첫 페이지 위반에는 제안이 있다", async () => {
    const { client } = await withDs();
    const rows = Array.from({ length: 400 }, (_, i) => `<div key={${i}} style={{ color: "#3B82F6", padding: ${i + 20} }} />`).join("\n");
    const res = await call(client, "lint_snippet", { code: `export const A = () => (<>\n${rows}\n</>);` });
    expect(estimateTokens(textOf(res))).toBeLessThanOrEqual(1500);
    const out = json(res);
    expect(out.truncated).toBe(true);
    expect(out.violations[0].suggestion).toBeDefined();
    expect(out.summary.hardcoded).toBe(800);
    expect(out.total).toBe(800);
  });
});
