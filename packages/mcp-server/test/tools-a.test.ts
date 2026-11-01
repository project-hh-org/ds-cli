import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeIndex, type ComponentUsage, type Index } from "@dsmith-dev/core";
import { detect, writeDetect } from "@dsmith-dev/detect";
import type { Client } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { estimateTokens } from "../src/budget.js";
import { TOOL_NAMES } from "../src/index.js";
import { WITH_DS_TOKENS_CSS, connect, copyFixture, indexFixture, json, textOf } from "./helpers.js";

const clients: Client[] = [];
const dirs: string[] = [];

async function open(rel: string, overlay?: Record<string, string>, indexed = true): Promise<{ client: Client; root: string }> {
  const root = copyFixture(rel, overlay);
  dirs.push(root);
  if (indexed) await indexFixture(root);
  const client = await connect({ root });
  clients.push(client);
  return { client, root };
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const withDs = (): Promise<{ client: Client; root: string }> =>
  open("fixtures/with-ds-app", { "components/ui/tokens.css": WITH_DS_TOKENS_CSS });

describe("서버 골격", () => {
  it("TOOL_NAMES는 계획의 여섯 개", () => {
    expect([...TOOL_NAMES]).toEqual([
      "resolve_token",
      "lint_snippet",
      "search_component",
      "get_component",
      "explain_decision",
      "list_decisions",
    ]);
  });

  it("listTools에 이 Task의 세 도구가 있고 설명이 있다", async () => {
    const { client } = await withDs();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["resolve_token", "lint_snippet", "search_component"]));
    for (const name of ["resolve_token", "lint_snippet", "search_component"]) {
      expect(tools.find((t) => t.name === name)?.description?.length).toBeGreaterThan(20);
    }
  });

  it("시작 시 index가 없으면 ensureIndex를 정확히 1회 부르고 그 뒤 도구가 동작한다", async () => {
    const root = copyFixture("fixtures/with-ds-app", { "components/ui/tokens.css": WITH_DS_TOKENS_CSS });
    dirs.push(root);
    const ensureIndex = vi.fn(indexFixture);
    const client = await connect({ root, ensureIndex });
    clients.push(client);
    // 워크스페이스는 첫 호출에서 연다 — 연결(핸드셰이크)만으로는 audit을 돌리지 않는다.
    expect(ensureIndex).not.toHaveBeenCalled();
    const [first, second] = await Promise.all([
      client.callTool({ name: "resolve_token", arguments: { raw: "#3B82F6" } }),
      client.callTool({ name: "search_component", arguments: { intent: "button" } }),
    ]);
    expect(second.isError).not.toBe(true);
    expect(ensureIndex).toHaveBeenCalledTimes(1);
    expect(ensureIndex).toHaveBeenCalledWith(root);
    const out = json(first);
    expect(out.token.name).toBe("--color-primary");
    await client.callTool({ name: "search_component", arguments: { intent: "button" } });
    expect(ensureIndex).toHaveBeenCalledTimes(1);
  });

  it("index가 이미 있으면 ensureIndex를 부르지 않는다", async () => {
    const root = copyFixture("fixtures/with-ds-app");
    dirs.push(root);
    await indexFixture(root);
    const ensureIndex = vi.fn(async () => {});
    clients.push(await connect({ root, ensureIndex }));
    expect(ensureIndex).not.toHaveBeenCalled();
  });

  it("ensureIndex 뒤에도 index가 없으면 첫 호출이 isError이고, 다음 호출이 다시 시도한다", async () => {
    const root = copyFixture("fixtures/with-ds-app");
    dirs.push(root);
    let calls = 0;
    const client = await connect({
      root,
      ensureIndex: async (r) => {
        calls += 1;
        if (calls > 1) await indexFixture(r);
      },
    });
    clients.push(client);
    const first = await client.callTool({ name: "resolve_token", arguments: { raw: "#fff" } });
    expect(first.isError).toBe(true);
    expect(textOf(first)).toMatch(/index\.json/);
    const second = await client.callTool({ name: "resolve_token", arguments: { raw: "#fff" } });
    expect(second.isError).not.toBe(true);
    expect(calls).toBe(2);
  });

  it("index.json을 다시 쓰면 다음 호출이 새 데이터를 본다", async () => {
    const { client, root } = await withDs();
    const before = json(await client.callTool({ name: "search_component", arguments: { intent: "zzzwidget" } }));
    expect(before.results).toEqual([]);

    const file = path.join(root, ".dsmith", "index.json");
    const index = JSON.parse(fs.readFileSync(file, "utf-8")) as Index;
    index.components.push({
      file: "src/x.tsx",
      line: 1,
      name: "Zzzwidget",
      importedFrom: "components/ui/zzzwidget",
      module: "components/ui/zzzwidget",
      props: [],
    });
    fs.writeFileSync(file, JSON.stringify(index));
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(file, future, future);

    const after = json(await client.callTool({ name: "search_component", arguments: { intent: "zzzwidget" } }));
    expect(after.results.map((r: { name: string }) => r.name)).toEqual(["Zzzwidget"]);
  });

  it("토큰 파일을 고치면 다음 resolve_token이 새 값을 본다", async () => {
    const { client, root } = await withDs();
    const file = path.join(root, "components/ui/tokens.css");
    fs.writeFileSync(file, WITH_DS_TOKENS_CSS.replace("#3b82f6", "#ff0000"));
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(file, future, future);
    const out = json(await client.callTool({ name: "resolve_token", arguments: { raw: "#ff0000" } }));
    expect(out.token).toMatchObject({ name: "--color-primary", value: "#ff0000" });
  });
});

describe("resolve_token", () => {
  it("색: 정확히 일치하면 high, 토큰 파일 출처", async () => {
    const { client } = await withDs();
    const out = json(await client.callTool({ name: "resolve_token", arguments: { raw: "#3B82F6" } }));
    expect(out).toMatchObject({
      input: { raw: "#3B82F6" },
      token: { name: "--color-primary", value: "#3b82f6" },
      confidence: "high",
      source: "token-file",
    });
    expect(out.distance).toBeLessThan(0.005);
    expect(out.alternatives.length).toBeLessThanOrEqual(3);
    expect(out.alternatives.map((a: { name: string }) => a.name)).not.toContain("--color-primary");
  });

  it("간격: property로 카테고리를 좁힌다", async () => {
    const { client } = await withDs();
    const padding = json(await client.callTool({ name: "resolve_token", arguments: { raw: "8px", property: "padding" } }));
    expect(padding.token.name).toBe("--space-2");
    expect(padding.confidence).toBe("high");
    expect(padding.input).toEqual({ raw: "8px", property: "padding" });
    const radius = json(await client.callTool({ name: "resolve_token", arguments: { raw: "6px", property: "border-radius" } }));
    expect(radius.token.name).toBe("--radius-md");
    const camel = json(await client.callTool({ name: "resolve_token", arguments: { raw: "6px", property: "borderRadius" } }));
    expect(camel.token.name).toBe("--radius-md");
  });

  it("가까운 값은 medium, 먼 값은 low이고 거리는 소수 4자리", async () => {
    const { client } = await withDs();
    const close = json(await client.callTool({ name: "resolve_token", arguments: { raw: "9px", property: "padding" } }));
    expect(close).toMatchObject({ confidence: "medium", distance: 1 });
    const far = json(await client.callTool({ name: "resolve_token", arguments: { raw: "13px", property: "padding" } }));
    expect(far.confidence).toBe("low");
    const color = json(await client.callTool({ name: "resolve_token", arguments: { raw: "#3a80f0" } }));
    expect(String(color.distance)).toMatch(/^\d+(\.\d{1,4})?$/);
  });

  it("해석할 수 없는 값은 isError", async () => {
    const { client } = await withDs();
    const result = await client.callTool({ name: "resolve_token", arguments: { raw: "nope" } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("값을 해석할 수 없음: nope");
  });

  it("빈 raw는 스키마 검증으로 isError", async () => {
    const { client } = await withDs();
    const result = await client.callTool({ name: "resolve_token", arguments: { raw: "" } });
    expect(result.isError).toBe(true);
  });

  it("토큰 파일이 없으면 제안 토큰(proposal)이고 읽지 않은 토큰 파일을 알린다", async () => {
    const { client } = await open("examples/legacy-demo");
    const out = json(await client.callTool({ name: "resolve_token", arguments: { raw: "#3B82F6" } }));
    expect(out.source).toBe("proposal");
    expect(out.token.value).toBe("#3b82f6");
    expect(out.ignoredTokenFiles).toEqual(["src/lib/theme.ts"]);
  });
});

describe("lint_snippet", () => {
  const lint = async (client: Client, args: Record<string, unknown>): Promise<any> =>
    json(await client.callTool({ name: "lint_snippet", arguments: args }));

  it("Tailwind 임의값 두 개를 위반으로 보고하고 토큰을 제안한다", async () => {
    const { client } = await withDs();
    const out = await lint(client, { code: 'export const A = () => <div className="text-[#3B82F6] p-[13px]" />' });
    expect(out.violations).toHaveLength(2);
    const color = out.violations.find((v: { property: string }) => v.property === "color");
    const padding = out.violations.find((v: { property: string }) => v.property === "padding");
    expect(color).toMatchObject({ raw: "text-[#3B82F6]", extractor: "tailwind", suggestion: { name: "--color-primary", confidence: "high" } });
    expect(padding).toBeDefined();
    expect(out.extractorsRun).toContain("tailwind");
    expect(out.summary.hardcoded).toBe(2);
  });

  it("인라인 스타일", async () => {
    const { client } = await withDs();
    const out = await lint(client, { code: 'export const A = () => <div style={{ color: "#3B82F6", padding: 13 }} />' });
    expect(out.violations).toHaveLength(2);
    expect(out.violations.every((v: { extractor: string }) => v.extractor === "inline-style")).toBe(true);
    expect(out.violations.map((v: { property: string }) => v.property).sort()).toEqual(["color", "padding"]);
  });

  it("styled-components는 줄 번호를 스니펫 기준으로 보고한다", async () => {
    const { client } = await withDs();
    const code = 'import styled from "styled-components";\nconst B = styled.button`color: #3B82F6;`';
    const out = await lint(client, { code });
    expect(out.violations).toHaveLength(1);
    expect(out.violations[0]).toMatchObject({ extractor: "styled", line: 2, property: "color", raw: "#3B82F6" });
  });

  it("토큰만 쓴 스니펫은 위반 0, token ≥ 1", async () => {
    const { client } = await withDs();
    const out = await lint(client, { code: 'export const A = () => <div style={{ color: "var(--color-primary)" }} />' });
    expect(out.violations).toEqual([]);
    expect(out.summary.token).toBeGreaterThanOrEqual(1);
    expect(out.summary.hardcoded).toBe(0);
  });

  it("filename으로 Extractor를 고른다(.css는 css Extractor)", async () => {
    const { client } = await withDs();
    const out = await lint(client, { code: ".a { color: #3B82F6; }", filename: "a.css" });
    expect(out.violations).toHaveLength(1);
    expect(out.violations[0].extractor).toBe("css");
  });

  it("문법 오류 스니펫은 parse(<name>) 오류", async () => {
    const { client } = await withDs();
    const result = await client.callTool({ name: "lint_snippet", arguments: { code: 'const a = <div style={{ color: "#fff" ' } });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/^parse\(/);
  });

  it("위반이 많으면 커서로 나눈다", async () => {
    const { client } = await withDs();
    const rows = Array.from({ length: 200 }, (_, i) => `  a${i}: { color: "#3B82F6", padding: ${13 + i} },`).join("\n");
    const code = `export const s = {\n${rows}\n};\nexport const A = () => (<>\n${Array.from({ length: 200 }, (_, i) => `<div key={${i}} style={{ color: "#3B82F6", padding: ${i + 30} }} />`).join("\n")}\n</>);`;
    const first = await client.callTool({ name: "lint_snippet", arguments: { code } });
    const page = json(first);
    expect(estimateTokens(textOf(first))).toBeLessThanOrEqual(1500);
    expect(page.truncated).toBe(true);
    expect(page.nextCursor).toBeDefined();
    const second = json(await client.callTool({ name: "lint_snippet", arguments: { code, cursor: page.nextCursor } }));
    expect(second.violations[0]).not.toEqual(page.violations[0]);
  });
});

describe("search_component", () => {
  const search = async (client: Client, args: Record<string, unknown>): Promise<any> =>
    json(await client.callTool({ name: "search_component", arguments: args }));

  it("버튼 → Button 두 module과 PrimaryButton", async () => {
    const { client } = await open("examples/legacy-demo");
    const out = await search(client, { intent: "버튼" });
    const found = out.results.map((r: { name: string; module: string }) => `${r.name}@${r.module}`);
    expect(found).toEqual(expect.arrayContaining(["Button@src/components/ui/button", "Button@src/components/Button"]));
    expect(out.results.map((r: { name: string }) => r.name)).toContain("PrimaryButton");
    expect(out.truncated).toBe(false);
  });

  it("표 → Table이 첫 번째", async () => {
    const { client } = await open("examples/legacy-demo");
    const out = await search(client, { intent: "표" });
    expect(out.results[0].name).toBe("Table");
  });

  it("limit 기본 10", async () => {
    const { client } = await open("examples/legacy-demo");
    const out = await search(client, { intent: "button input select table card modal badge" });
    expect(out.results.length).toBeLessThanOrEqual(10);
    const limited = await search(client, { intent: "button input select table card modal badge", limit: 2 });
    expect(limited.results).toHaveLength(2);
  });

  it("limit 범위 밖은 isError", async () => {
    const { client } = await open("examples/legacy-demo");
    const result = await client.callTool({ name: "search_component", arguments: { intent: "button", limit: 51 } });
    expect(result.isError).toBe(true);
  });

  it("컴포넌트 1,000개에서 limit 50이어도 응답이 상한 이하이고 커서로 이어진다", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-mcp-big-"));
    dirs.push(root);
    fs.writeFileSync(path.join(root, "package.json"), "{}\n");
    const components: ComponentUsage[] = Array.from({ length: 1000 }, (_, i) => ({
      file: `src/pages/Page${i}.tsx`,
      line: 3,
      name: `Button${i}`,
      importedFrom: `packages/design-system/src/components/buttons/Button${i}`,
      module: `packages/design-system/src/components/buttons/Button${i}`,
      props: ["buttonVariant", "buttonSize", "children", "onClick", "disabled"],
    }));
    const index: Index = {
      root,
      createdAt: new Date().toISOString(),
      extractors: [],
      files: { scanned: 1000, skipped: [] },
      styles: [],
      components,
    };
    await writeIndex(root, index);
    await writeDetect(root, await detect(root, index));

    const client = await connect({ root });
    clients.push(client);
    const first = await client.callTool({ name: "search_component", arguments: { intent: "button", limit: 50 } });
    const page = json(first);
    expect(estimateTokens(textOf(first))).toBeLessThanOrEqual(1500);
    expect(page.truncated).toBe(true);
    expect(page.total).toBe(50);

    const names: string[] = page.results.map((r: { name: string }) => r.name);
    let cursor: string | undefined = page.nextCursor;
    while (cursor !== undefined) {
      const next = await client.callTool({ name: "search_component", arguments: { intent: "button", limit: 50, cursor } });
      expect(estimateTokens(textOf(next))).toBeLessThanOrEqual(1500);
      const body = json(next);
      names.push(...body.results.map((r: { name: string }) => r.name));
      cursor = body.nextCursor;
    }
    expect(names).toHaveLength(50);
    expect(new Set(names).size).toBe(50);
  });
});

describe("resources", () => {
  it("tokens://list", async () => {
    const { client } = await withDs();
    const { contents } = await client.readResource({ uri: "tokens://list" });
    const body = JSON.parse((contents[0] as { text: string }).text);
    expect(body.source).toBe("token-file");
    expect(body.names).toEqual(expect.arrayContaining(["--color-primary", "--space-2", "--radius-md"]));
  });

  it("components://list: module이 없는 지역 사용은 제외, Button 2건", async () => {
    const { client } = await open("examples/legacy-demo");
    const { contents } = await client.readResource({ uri: "components://list" });
    const body = JSON.parse((contents[0] as { text: string }).text);
    expect(body.source).toBe("index");
    expect(body.components.filter((c: { name: string }) => c.name === "Button")).toHaveLength(2);
    expect(body.components.every((c: { module: string }) => c.module !== "")).toBe(true);
  });

  it("listResources에 두 리소스", async () => {
    const { client } = await withDs();
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual(["components://list", "tokens://list"]);
  });
});


describe("lint_snippet filename 힌트", () => {
  const lint = async (client: Client, args: Record<string, unknown>): Promise<any> =>
    json(await client.callTool({ name: "lint_snippet", arguments: args }));
  const HINT = "filename을 지정하세요 (예: styles.css, Button.tsx)";

  it("filename 없이 CSS를 주면 위반 없이 조용히 끝내지 않고 힌트를 준다", async () => {
    const { client } = await withDs();
    for (const code of [".btn { color: #ff0000; padding: 13px; }", "#root { margin: 13px }", ":root { --a: 1px; }", "@media (min-width: 1px) { .a { color: red; } }", "a:hover { color: #123456; }"]) {
      const out = await lint(client, { code });
      expect(out.violations, code).toEqual([]);
      expect(out.hint, code).toBe(HINT);
    }
  });

  it("filename을 주면 같은 CSS가 위반으로 잡히고 힌트는 없다", async () => {
    const { client } = await withDs();
    const out = await lint(client, { code: ".btn { color: #ff0000; }", filename: "styles.css" });
    expect(out.violations).toHaveLength(1);
    expect(out).not.toHaveProperty("hint");
  });

  it("JSX·빈 코드·위반이 있는 tsx에는 힌트를 붙이지 않는다", async () => {
    const { client } = await withDs();
    expect(await lint(client, { code: "export const A = () => <div />" })).not.toHaveProperty("hint");
    expect(await lint(client, { code: "" })).not.toHaveProperty("hint");
    expect(await lint(client, { code: 'export const A = () => <div style={{ color: "#3B82F6" }} />' })).not.toHaveProperty("hint");
  });

  it("실행된 Extractor가 없으면(appliesTo가 모두 거짓) 힌트를 준다", async () => {
    const { lintSnippet } = await import("../src/tools/lint-snippet.js");
    const idle = { name: "idle", files: ["**/*.tsx"], appliesTo: () => false, extract: () => [] };
    const run = (code: string, filename?: string) => lintSnippet({ root: "/x" } as never, [idle as never], { code, filename });
    const out = run("padding: 13px");
    expect(out.extractorsRun).toEqual([]);
    expect(out.hint).toBe(HINT);
    expect(run("  ")).not.toHaveProperty("hint");
    expect(run("const a = 1;")).not.toHaveProperty("hint");
    expect(run("padding: 13px", "a.tsx")).not.toHaveProperty("hint");
  });
});

describe("lint_snippet suggestion.distance", () => {
  it("제안에 distance가 있다(resolve_token과 같은 단위)", async () => {
    const { client } = await withDs();
    const out = json(await client.callTool({ name: "lint_snippet", arguments: { code: 'export const A = () => <div style={{ color: "#3B82F6", padding: 13 }} />' } }));
    for (const v of out.violations) {
      if (v.suggestion !== undefined) expect(typeof v.suggestion.distance).toBe("number");
    }
    const color = out.violations.find((v: { property: string }) => v.property === "color");
    expect(color.suggestion).toMatchObject({ name: "--color-primary", confidence: "high" });
    expect(typeof color.suggestion.distance).toBe("number");
    const padding = out.violations.find((v: { property: string }) => v.property === "padding");
    expect(padding.suggestion?.distance).toBe(5);
  });
});
