// MCP SDK v2 결합부 — SDK import는 이 파일에만 둔다(v1 폴백이 필요하면 이 파일만 고친다).
// 확인: 2026-11-01, @modelcontextprotocol/server·client 2.4.0 (부록 A.1)
//   https://registry.npmjs.org/@modelcontextprotocol/server
//   https://github.com/modelcontextprotocol/typescript-sdk
//   https://ts.sdk.modelcontextprotocol.io/v2/
import { createHash } from "node:crypto";
import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { DEFAULT_TOKEN_BUDGET, clipJson, clipMessage, paginate, shrinkToBudget, toText, type Page } from "./budget.js";
import type { ServerDeps } from "./index.js";
import { componentsList, tokensList } from "./resources.js";
import { explainDecisionTool, shrinkCard } from "./tools/explain-decision.js";
import { getComponent } from "./tools/get-component.js";
import { lintSnippet, suggestionFor } from "./tools/lint-snippet.js";
import { listDecisionsTool } from "./tools/list-decisions.js";
import { resolveToken } from "./tools/resolve-token.js";
import { searchComponent } from "./tools/search-component.js";
import { openWorkspace, type Workspace, type WorkspaceHandle } from "./workspace.js";

/** 입력 문자열 길이 상한 — 응답에 되돌려 싣는 값이 상한을 우회하지 못하게 한다. */
const MAX_TEXT = 200;
const MAX_PROPERTY = 64;
const MAX_CURSOR = 64;

/** 모든 응답의 마지막 방어선: 상한을 넘는 본문은 잘라서 `truncated: true`로 보낸다. */
function okWith(value: unknown, budget: number): CallToolResult {
  // structuredContent는 쓰지 않는다 — 본문이 두 번 실려 토큰이 두 배가 된다.
  return { content: [{ type: "text", text: clipJson(toText(value), budget) }] };
}

function failWith(err: unknown, budget: number): CallToolResult {
  const message = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: "text", text: clipMessage(message, budget) }] };
}

/** 목록형 페이지 → `{ [key]: items, ...extra, total, truncated, nextCursor? }` */
function listPage<T>(key: string, extra: object = {}): (page: Page<T>) => object {
  return (page) => ({
    [key]: page.items,
    ...extra,
    total: page.total,
    truncated: page.truncated,
    ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
  });
}

/** 데이터 버전 + 이 호출의 인자로 만든 cursor 표식. 데이터나 인자가 바뀌면 이전 cursor는 거절된다. */
function stampOf(ws: Workspace, ...args: unknown[]): string {
  return createHash("sha1").update(ws.version).update(JSON.stringify(args)).digest("hex").slice(0, 8);
}

/**
 * 서버를 만든다. 워크스페이스(인덱스 읽기, 없으면 ensureIndex)는 첫 도구·리소스 호출에서 연다 —
 * 핸드셰이크가 audit 때문에 늦어지지 않게 한다. 열기에 실패하면 다음 호출이 다시 시도한다.
 */
export function createDsmithServer(deps: ServerDeps): Promise<McpServer> {
  const budget = deps.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
  const server = new McpServer({ name: "dsmith", version: deps.version });
  const readOnly = { readOnlyHint: true, openWorldHint: false };

  let opening: Promise<WorkspaceHandle> | undefined;
  const workspace = async (): Promise<Workspace> => {
    opening ??= openWorkspace(deps).catch((err: unknown) => {
      opening = undefined;
      throw err;
    });
    return (await opening).get();
  };
  const ok = (value: unknown): CallToolResult => okWith(value, budget);
  const guarded = async (fn: () => Promise<unknown>): Promise<CallToolResult> => {
    try {
      return ok(await fn());
    } catch (err) {
      return failWith(err, budget);
    }
  };

  server.registerTool(
    "resolve_token",
    {
      description:
        "Map a raw style value (#3B82F6, 13px, var(--x)) to the closest design token (source says where the token came from: token-file, catalog or proposal). distance is oklch ΔE_ok for colors and px for lengths; confidence is high for ΔE < 0.005 or 0px, medium for ΔE < 0.03 or ≤ 2px, else low. Pass property (padding, border-radius, ...) to compare only that category. Use before writing any hardcoded color or spacing.",
      inputSchema: z.object({ raw: z.string().min(1).max(MAX_TEXT), property: z.string().max(MAX_PROPERTY).optional() }),
      annotations: readOnly,
    },
    (args) => guarded(async () => resolveToken(await workspace(), args)),
  );

  server.registerTool(
    "lint_snippet",
    {
      description:
        "Check a code snippet for hardcoded colors and spacing and suggest the nearest design token for each (suggestion has name, value, distance and confidence, as in resolve_token). filename picks the extractors (.tsx, .css, ...); without it the snippet is read as .tsx, so pass filename for CSS (a hint says so when nothing could be checked). Use on code you just wrote or are about to write, before saving it.",
      inputSchema: z.object({
        code: z.string().max(100_000),
        filename: z.string().max(MAX_TEXT).optional(),
        cursor: z.string().max(MAX_CURSOR).optional(),
      }),
      annotations: readOnly,
    },
    (args) =>
      guarded(async () => {
        const ws = await workspace();
        const { violations, ...rest } = lintSnippet(ws, deps.extractors, args);
        return paginate(violations, args.cursor, budget, listPage("violations", rest), {
          stamp: stampOf(ws, args.code, args.filename),
          enrich: (v) => suggestionFor(ws, v),
        });
      }),
  );

  server.registerTool(
    "search_component",
    {
      description:
        "Find existing components in this repo by intent (e.g. 'date picker', '버튼'), including design-system components in the catalog that nothing uses yet. Returns up to limit matches (matched = count before limit). Use before creating a new component to avoid duplicates.",
      inputSchema: z.object({
        intent: z.string().min(1).max(MAX_TEXT),
        limit: z.number().int().min(1).max(50).optional(),
        cursor: z.string().max(MAX_CURSOR).optional(),
      }),
      annotations: readOnly,
    },
    (args) =>
      guarded(async () => {
        const ws = await workspace();
        const { matches, matched } = searchComponent(ws, args);
        return paginate(matches, args.cursor, budget, listPage("results", { matched }), { stamp: stampOf(ws, args.intent, args.limit) });
      }),
  );

  server.registerTool(
    "get_component",
    {
      description:
        "Get a component's props (with allowed values), variants, usage count and definition file from this repo. When the repo has a catalog (dsmith ai), the answer comes from it (source catalog: also description, deprecated, one usage example, origin); otherwise from the usage index and the definition file (source index). When several modules export the same name, returns the one chosen with decide, else the design-system or catalog one, else the most used (isDs and decided say which; the rest are in otherModules). Use before using or changing a component.",
      inputSchema: z.object({ name: z.string().min(1).max(MAX_TEXT), module: z.string().max(MAX_TEXT).optional() }),
      annotations: readOnly,
    },
    async (args): Promise<CallToolResult> => {
      try {
        const result = await getComponent(await workspace(), args);
        // explain_decision처럼 실패는 오류 객체(isError)로, 비슷한 이름은 similar에 담는다.
        if ("error" in result) return { isError: true, content: [{ type: "text", text: clipJson(toText(result), budget) }] };
        return ok(shrinkToBudget(result, budget));
      } catch (err) {
        return failWith(err, budget);
      }
    },
  );

  server.registerTool(
    "explain_decision",
    {
      description:
        "Explain a duplicate or locally redefined component, or a token-cluster (kind token-cluster: options are near-identical color hex values to merge into one token; recommendation is by usage; ruleCheck is n/a): options, differences, impact of each choice and a recommendation. impact.byOption[x] = call sites and files that would have to change if x is chosen (not x's usage; usage is options[].usageCount). ruleCheck.tokenUsageRate[x] = share of the rated styles in x's definition file that already use a token; null = nothing rated. ruleCheck.tokenMatchRate[x] (only when the repo has token files) = share of those styles that use a token or hardcode a value within close range of one. Use when several components do the same job and you must pick one.",
      inputSchema: z.object({ item: z.string().min(1).max(MAX_TEXT), kind: z.enum(["duplicate", "local-definition", "token-cluster"]).optional() }),
      annotations: readOnly,
    },
    async (args): Promise<CallToolResult> => {
      try {
        const result = await explainDecisionTool(await workspace(), args, { git: deps.git !== false });
        // CLI `decide --explain --json`과 같은 값: 카드 그대로, 실패는 오류 객체(isError).
        if ("error" in result) return { isError: true, content: [{ type: "text", text: clipJson(toText(result), budget) }] };
        return ok(shrinkCard(result.card, budget));
      } catch (err) {
        return failWith(err, budget);
      }
    },
  );

  server.registerTool(
    "list_decisions",
    {
      description:
        "List duplicate or locally redefined components and token-cluster color groups (kind token-cluster; options are hex values) that still need a decision, and the ones already decided (those carry chosen = the picked option id; stale = true means the options changed since, so decide again). Use to see which choices are open before building UI.",
      inputSchema: z.object({ status: z.enum(["pending", "decided"]).optional(), cursor: z.string().max(MAX_CURSOR).optional() }),
      annotations: readOnly,
    },
    (args) =>
      guarded(async () => {
        const ws = await workspace();
        return paginate(listDecisionsTool(ws, args), args.cursor, budget, listPage("decisions"), { stamp: stampOf(ws, args.status) });
      }),
  );

  server.registerResource(
    "tokens",
    "tokens://list",
    { mimeType: "application/json", description: "Names of the design tokens available in this repo (source token-file, catalog, proposal or mixed)." },
    async (uri) => ({ contents: [{ uri: uri.href, text: toText(tokensList(await workspace())) }] }),
  );
  server.registerResource(
    "components",
    "components://list",
    { mimeType: "application/json", description: "Components of this repo's catalog (source catalog), or else the components imported in this repo, most used first (source index)." },
    async (uri) => ({ contents: [{ uri: uri.href, text: toText(componentsList(await workspace())) }] }),
  );

  return Promise.resolve(server);
}

/** stderr에 root를 먼저 남기고 곧바로 stdio에 연결한다(워크스페이스는 첫 호출에서 연다). */
export async function startStdioServer(deps: ServerDeps): Promise<void> {
  (deps.log ?? ((line: string) => process.stderr.write(`${line}\n`)))(`dsmith mcp: root=${deps.root}`);
  const server = await createDsmithServer(deps);
  await server.connect(new StdioServerTransport());
}
