// MCP SDK v2 결합부 — SDK import는 이 파일에만 둔다(v1 폴백이 필요하면 이 파일만 고친다).
// 확인: 2026-11-01, @modelcontextprotocol/server·client 2.4.0 (부록 A.1)
//   https://registry.npmjs.org/@modelcontextprotocol/server
//   https://github.com/modelcontextprotocol/typescript-sdk
//   https://ts.sdk.modelcontextprotocol.io/v2/
import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { DEFAULT_TOKEN_BUDGET, paginate, shrinkToBudget, toText, type Page } from "./budget.js";
import type { ServerDeps } from "./index.js";
import { componentsList, tokensList } from "./resources.js";
import { explainDecisionTool } from "./tools/explain-decision.js";
import { getComponent } from "./tools/get-component.js";
import { lintSnippet } from "./tools/lint-snippet.js";
import { listDecisionsTool } from "./tools/list-decisions.js";
import { resolveToken } from "./tools/resolve-token.js";
import { searchComponent } from "./tools/search-component.js";
import { openWorkspace } from "./workspace.js";

function ok(value: unknown): CallToolResult {
  // structuredContent는 쓰지 않는다 — 본문이 두 번 실려 토큰이 두 배가 된다.
  return { content: [{ type: "text", text: toText(value) }] };
}

function fail(err: unknown): CallToolResult {
  return { isError: true, content: [{ type: "text", text: err instanceof Error ? err.message : String(err) }] };
}

async function guarded(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    return fail(err);
  }
}

/** 목록형 페이지 → `{ ...extra, [key]: items, total, truncated, nextCursor? }` */
function listPage<T>(key: string, extra: object = {}): (page: Page<T>) => object {
  return (page) => ({
    [key]: page.items,
    ...extra,
    total: page.total,
    truncated: page.truncated,
    ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
  });
}

export async function createDsmithServer(deps: ServerDeps): Promise<McpServer> {
  const workspace = await openWorkspace(deps);
  const budget = deps.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
  const server = new McpServer({ name: "dsmith", version: deps.version });
  const readOnly = { readOnlyHint: true, openWorldHint: false };

  server.registerTool(
    "resolve_token",
    {
      description:
        "Map a raw style value (#3B82F6, 13px) to the closest design token with distance and confidence. Use before writing any hardcoded color or spacing.",
      inputSchema: z.object({ raw: z.string().min(1), property: z.string().optional() }),
      annotations: readOnly,
    },
    (args) => guarded(async () => resolveToken(await workspace.get(), args)),
  );

  server.registerTool(
    "lint_snippet",
    {
      description:
        "Check a code snippet for hardcoded colors and spacing and suggest the nearest design token for each. Use on code you just wrote or are about to write, before saving it.",
      inputSchema: z.object({
        code: z.string().max(100_000),
        filename: z.string().optional(),
        cursor: z.string().optional(),
      }),
      annotations: readOnly,
    },
    (args) =>
      guarded(async () => {
        const out = lintSnippet(await workspace.get(), deps.extractors, args);
        const { violations, ...rest } = out;
        return paginate(violations, args.cursor, budget, listPage("violations", rest));
      }),
  );

  server.registerTool(
    "search_component",
    {
      description:
        "Find existing components in this repo by intent (e.g. 'date picker', '버튼'). Use before creating a new component to avoid duplicates.",
      inputSchema: z.object({
        intent: z.string().min(1),
        limit: z.number().int().min(1).max(50).optional(),
        cursor: z.string().optional(),
      }),
      annotations: readOnly,
    },
    (args) =>
      guarded(async () =>
        paginate(searchComponent(await workspace.get(), args), args.cursor, budget, listPage("results")),
      ),
  );

  server.registerTool(
    "get_component",
    {
      description:
        "Get a component's props (with allowed values), variants, usage count and definition file from this repo. Use before using or changing a component.",
      inputSchema: z.object({ name: z.string().min(1), module: z.string().optional() }),
      annotations: readOnly,
    },
    (args) => guarded(async () => shrinkToBudget(await getComponent(await workspace.get(), args), budget)),
  );

  server.registerTool(
    "explain_decision",
    {
      description:
        "Explain a duplicate or locally redefined component: options, differences, impact of each choice and a recommendation. Use when several components do the same job and you must pick one.",
      inputSchema: z.object({ item: z.string().min(1), kind: z.enum(["duplicate", "local-definition"]).optional() }),
      annotations: readOnly,
    },
    async (args): Promise<CallToolResult> => {
      try {
        const result = await explainDecisionTool(await workspace.get(), args, { git: deps.git !== false });
        // CLI `decide --explain --json`과 같은 값: 카드 그대로, 실패는 오류 객체(isError).
        if ("error" in result) return { isError: true, content: [{ type: "text", text: toText(result) }] };
        return ok(shrinkToBudget(result.card, budget));
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "list_decisions",
    {
      description:
        "List duplicate or locally redefined components that still need a decision, and the ones already decided. Use to see which choices are open before building UI.",
      inputSchema: z.object({ status: z.enum(["pending", "decided"]).optional(), cursor: z.string().optional() }),
      annotations: readOnly,
    },
    (args) =>
      guarded(async () =>
        paginate(listDecisionsTool(await workspace.get(), args), args.cursor, budget, listPage("decisions")),
      ),
  );

  server.registerResource(
    "tokens",
    "tokens://list",
    { mimeType: "application/json", description: "Names of the design tokens available in this repo." },
    async (uri) => ({ contents: [{ uri: uri.href, text: toText(tokensList(await workspace.get())) }] }),
  );
  server.registerResource(
    "components",
    "components://list",
    { mimeType: "application/json", description: "Components imported in this repo, most used first." },
    async (uri) => ({ contents: [{ uri: uri.href, text: toText(componentsList(await workspace.get())) }] }),
  );

  return server;
}

export async function startStdioServer(deps: ServerDeps): Promise<void> {
  const server = await createDsmithServer(deps);
  await server.connect(new StdioServerTransport());
  (deps.log ?? ((line: string) => process.stderr.write(`${line}\n`)))(`dsmith mcp: root=${deps.root}`);
}
