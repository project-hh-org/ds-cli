import fs from "node:fs";
import path from "node:path";
import { chooseDecision, readIndex, type ComponentUsage } from "@dsmith-dev/core";
import type { Client } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { estimateTokens } from "../src/budget.js";
import { TOOL_NAMES } from "../src/index.js";
import { connect, copyFixture, indexFixture, json, syntheticRoot, textOf, usageOf } from "./helpers.js";

const clients: Client[] = [];
const dirs: string[] = [];

async function open(rel: string, overlay?: Record<string, string>): Promise<{ client: Client; root: string }> {
  const root = copyFixture(rel, overlay);
  dirs.push(root);
  await indexFixture(root);
  const client = await connect({ root, git: false });
  clients.push(client);
  return { client, root };
}

async function openSynthetic(components: ComponentUsage[]): Promise<{ client: Client; root: string }> {
  const root = await syntheticRoot(components);
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

describe("서버: 여섯 도구", () => {
  it("listTools = TOOL_NAMES", async () => {
    const { client } = await open("fixtures/with-ds-app");
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
  });
});

describe("get_component", () => {
  it("with-ds-app Button: 사용 수 최대 module, 타입에서 읽은 props, 다른 module", async () => {
    const { client } = await open("fixtures/with-ds-app");
    const out = json(await call(client, "get_component", { name: "Button" }));
    expect(out).toMatchObject({
      name: "Button",
      module: "src/legacy/Button",
      propsSource: "type",
      props: [{ name: "children", type: "ReactNode", required: true }],
      otherModules: ["components/ui/Button"],
      source: "index",
      definitionFile: "src/legacy/Button.tsx",
    });
    expect(out.usage.count).toBe(2);
    expect(out.usage.files.length).toBeLessThanOrEqual(5);
  });

  it("module을 지정하면 그 module만", async () => {
    const { client } = await open("fixtures/with-ds-app");
    const out = json(await call(client, "get_component", { name: "Button", module: "components/ui/Button" }));
    expect(out.module).toBe("components/ui/Button");
    expect(out.usage.count).toBe(1);
    expect(out).not.toHaveProperty("otherModules");
  });

  it("없는 컴포넌트는 isError, 비슷한 이름을 알려준다", async () => {
    const { client } = await open("fixtures/with-ds-app");
    const bad = await call(client, "get_component", { name: "Nope" });
    expect(bad.isError).toBe(true);
    expect(textOf(bad)).toContain("컴포넌트 없음: Nope");
    const near = await call(client, "get_component", { name: "Butto" });
    expect(near.isError).toBe(true);
    expect(textOf(near)).toContain("Button");
  });

  it("legacy-demo: Badge의 color 값 목록", async () => {
    const { client } = await open("examples/legacy-demo");
    const out = json(await call(client, "get_component", { name: "Badge", module: "src/components/Badge" }));
    const color = out.props.find((p: { name: string }) => p.name === "color");
    expect(color.values).toEqual(["blue", "gray", "red"]);
  });

  it("legacy-demo: Button variants·inherits", async () => {
    const { client } = await open("examples/legacy-demo");
    const out = json(await call(client, "get_component", { name: "Button", module: "src/components/Button" }));
    expect(out.variants).toEqual(["primary", "secondary", "danger"]);
    expect(out.inherits).toHaveLength(1);
  });

  it("패키지 module(점·슬래시 없는 이름)은 정의 파일을 찾지 않고 사용처 props만 쓴다", async () => {
    const { client, root } = await openSynthetic([
      usageOf("Link", "next", "src/a.tsx", ["href", "prefetch"]),
      usageOf("Helper", "lib", "src/b.tsx", ["x"]),
    ]);
    // 루트에 `lib.tsx`가 있어도 패키지 `lib`와 구분할 수 없으므로 읽지 않는다.
    fs.writeFileSync(path.join(root, "lib.tsx"), "export function Helper(p: { y: string }) { return null; }\n");
    const link = json(await call(client, "get_component", { name: "Link" }));
    expect(link).toMatchObject({ propsSource: "usage", props: [{ name: "href" }, { name: "prefetch" }] });
    expect(link).not.toHaveProperty("definitionFile");
    const helper = json(await call(client, "get_component", { name: "Helper" }));
    expect(helper.propsSource).toBe("usage");
    expect(helper).not.toHaveProperty("definitionFile");
  });

  it("props가 200개면 상한 안으로 줄고 omitted.props를 알린다", async () => {
    const props = Array.from({ length: 200 }, (_, i) => `someVeryDescriptivePropName${i}`);
    const { client } = await openSynthetic([usageOf("Wide", "src/ui/Wide", "src/a.tsx", props)]);
    const res = await call(client, "get_component", { name: "Wide" });
    const out = json(res);
    expect(estimateTokens(textOf(res))).toBeLessThanOrEqual(1500);
    expect(out.truncated).toBe(true);
    expect(out.omitted.props).toBeGreaterThan(0);
    expect(out.props.length + out.omitted.props).toBe(200);
  });
});

describe("explain_decision", () => {
  it("with-ds-app Button: 카드 그대로(옵션 2, DS 모듈 추천 high)", async () => {
    const { client } = await open("fixtures/with-ds-app");
    const card = json(await call(client, "explain_decision", { item: "Button" }));
    expect(card.kind).toBe("duplicate");
    expect(card.options).toHaveLength(2);
    expect(card.recommendation).toMatchObject({ optionId: "components/ui/Button", confidence: "high", rule: "ds-module" });
    expect(card).not.toHaveProperty("history"); // git:false
    expect(card).not.toHaveProperty("card");
  });

  it("항목이 아니면 isError + CLI와 같은 not-found 객체", async () => {
    const { client } = await open("fixtures/with-ds-app");
    const res = await call(client, "explain_decision", { item: "Butto" });
    expect(res.isError).toBe(true);
    expect(json(res)).toEqual({ error: "not-found", candidates: ["Button"] });
  });

  it("결정을 기록하면 decided가 카드에 나타난다", async () => {
    const { client, root } = await open("fixtures/with-ds-app");
    expect(json(await call(client, "explain_decision", { item: "Button" }))).not.toHaveProperty("decided");
    const index = await readIndex(root);
    if (index === null) throw new Error("no index");
    await chooseDecision(root, index, "Button", "components/ui/Button");
    const card = json(await call(client, "explain_decision", { item: "Button" }));
    expect(card.decided).toMatchObject({ chosen: "components/ui/Button" });
  });

  const both = (): ComponentUsage[] => [
    usageOf("Tab", "src/ui/Tab", "src/a.tsx"),
    usageOf("Tab", "src/legacy/Tab", "src/b.tsx"),
    { file: "src/c.tsx", line: 1, name: "Tab", importedFrom: null, module: "", props: [], declaredLocally: true },
    { file: "src/d.tsx", line: 1, name: "Tab", importedFrom: null, module: "", props: [], declaredLocally: true },
  ];

  it("duplicate이면서 지역 재정의인 이름은 kind 없이 isError(두 종류를 알림), kind를 주면 카드", async () => {
    const { client } = await openSynthetic(both());
    const amb = await call(client, "explain_decision", { item: "Tab" });
    expect(amb.isError).toBe(true);
    expect(json(amb)).toEqual({ error: "ambiguous-kind", kinds: ["duplicate", "local-definition"] });
    const dup = json(await call(client, "explain_decision", { item: "Tab", kind: "duplicate" }));
    expect(dup.kind).toBe("duplicate");
    const local = json(await call(client, "explain_decision", { item: "Tab", kind: "local-definition" }));
    expect(local.kind).toBe("local-definition");
    expect(local.options.map((o: { id: string }) => o.id)).toEqual(["src/c.tsx", "src/d.tsx"]);
  });

  it("옵션이 120개여도 maxOptions(20)로 줄인 뒤 상한 안에 들어온다", async () => {
    const comps = Array.from({ length: 120 }, (_, i) =>
      usageOf("Card", `packages/design-system/src/cards/Card${i}`, `src/pages/Page${i}.tsx`, ["title", "footer"]),
    );
    const { client } = await openSynthetic(comps);
    const res = await call(client, "explain_decision", { item: "Card" });
    const card = json(res);
    expect(estimateTokens(textOf(res))).toBeLessThanOrEqual(1500);
    expect(card.options.length).toBeLessThanOrEqual(20);
    expect(card.omittedOptions.count).toBeGreaterThanOrEqual(100);
    expect(card.recommendation.optionId).toBeDefined();
  });
});

describe("list_decisions", () => {
  it("legacy-demo: Button·Badge 중복이 pending, options는 module 목록", async () => {
    const { client } = await open("examples/legacy-demo");
    const out = json(await call(client, "list_decisions", {}));
    const names = out.decisions.map((d: { item: string }) => d.item);
    expect(names.slice(0, 2)).toEqual(["Button", "Badge"]);
    expect(out.decisions[0]).toMatchObject({ item: "Button", kind: "duplicate", status: "pending", optionCount: 2 });
    expect(out.decisions[0].options).toHaveLength(2);
    expect(out.truncated).toBe(false);
  });

  it("결정을 기록하면 같은 서버의 다음 호출이 decided로 본다", async () => {
    const { client, root } = await open("examples/legacy-demo");
    const index = await readIndex(root);
    if (index === null) throw new Error("no index");
    await chooseDecision(root, index, "Badge", "src/components/Badge");
    const all = json(await call(client, "list_decisions", {}));
    expect(all.decisions.find((d: { item: string }) => d.item === "Badge")).toMatchObject({
      status: "decided",
      decided: "src/components/Badge",
    });
    const pending = json(await call(client, "list_decisions", { status: "pending" }));
    expect(pending.decisions.map((d: { item: string }) => d.item)).not.toContain("Badge");
    const decided = json(await call(client, "list_decisions", { status: "decided" }));
    expect(decided.decisions.map((d: { item: string }) => d.item)).toEqual(["Badge"]);
  });

  it("잘못된 status는 isError", async () => {
    const { client } = await open("examples/legacy-demo");
    expect((await call(client, "list_decisions", { status: "done" })).isError).toBe(true);
  });
});

describe("응답 상한: 합성 워크스페이스", () => {
  async function bigWorkspace(): Promise<Client> {
    const comps: ComponentUsage[] = [];
    for (let i = 0; i < 1000; i++) {
      comps.push(usageOf(`Button${i}`, `packages/design-system/src/components/buttons/Button${i}`, `src/pages/Page${i}.tsx`, ["buttonVariant", "buttonSize"]));
    }
    comps.push(usageOf("Wide", "src/ui/Wide", "src/w.tsx", Array.from({ length: 200 }, (_, i) => `someVeryDescriptivePropName${i}`)));
    for (let i = 0; i < 30; i++) comps.push(usageOf("Card", `packages/design-system/src/cards/Card${i}`, `src/pages/Card${i}.tsx`, ["title"]));
    for (let i = 0; i < 300; i++) {
      comps.push(usageOf(`Dup${i}`, `src/a/Dup${i}`, `src/x${i}.tsx`), usageOf(`Dup${i}`, `src/b/Dup${i}`, `src/y${i}.tsx`));
    }
    return (await openSynthetic(comps)).client;
  }

  it("여섯 도구 모두 estimateTokens ≤ 1500", async () => {
    const client = await bigWorkspace();
    const violations = Array.from({ length: 300 }, (_, i) => `<div key={${i}} style={{ color: "#3B82F6", padding: ${i + 20} }} />`).join("\n");
    const calls: [string, Record<string, unknown>][] = [
      ["resolve_token", { raw: "#3B82F6" }],
      ["lint_snippet", { code: `export const A = () => (<>\n${violations}\n</>);` }],
      ["search_component", { intent: "button", limit: 50 }],
      ["get_component", { name: "Wide" }],
      ["explain_decision", { item: "Card" }],
      ["list_decisions", {}],
    ];
    for (const [name, args] of calls) {
      const res = await call(client, name, args);
      expect(res.isError, name).not.toBe(true);
      expect(estimateTokens(textOf(res)), name).toBeLessThanOrEqual(1500);
    }
    const list = json(await call(client, "list_decisions", {}));
    expect(list.truncated).toBe(true);
    expect(list.decisions[0].options.length).toBeLessThanOrEqual(10);
  });

  it("list_decisions 커서를 따라가면 모든 항목을 한 번씩 본다", async () => {
    const client = await bigWorkspace();
    const seen: string[] = [];
    let cursor: string | undefined;
    let total = 0;
    do {
      const res = await call(client, "list_decisions", cursor === undefined ? {} : { cursor });
      expect(estimateTokens(textOf(res))).toBeLessThanOrEqual(1500);
      const page = json(res);
      total = page.total;
      seen.push(...page.decisions.map((d: { item: string }) => d.item));
      cursor = page.nextCursor;
    } while (cursor !== undefined);
    expect(total).toBe(301); // Dup0…Dup299 + Card
    expect(seen).toHaveLength(301);
    expect(new Set(seen).size).toBe(301);
  });
});

