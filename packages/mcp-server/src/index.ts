import type { Extractor } from "@dsmith-dev/extractor-api";

export const TOOL_NAMES = [
  "resolve_token",
  "lint_snippet",
  "search_component",
  "get_component",
  "explain_decision",
  "list_decisions",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export interface ServerDeps {
  /** 절대 경로 */
  root: string;
  /** dsmith 버전 (serverInfo) */
  version: string;
  /** lint_snippet용 — CLI는 레지스트리 전부 */
  extractors: Extractor[];
  /** .dsmith/index.json 또는 detect.json이 없을 때 1회. CLI는 runAudit */
  ensureIndex: (root: string) => Promise<void>;
  /** 기본 DEFAULT_TOKEN_BUDGET */
  tokenBudget?: number;
  /** explain_decision의 git 이력. 기본 true */
  git?: boolean;
  /** 기본 stderr */
  log?: (line: string) => void;
}

export { createDsmithServer, startStdioServer } from "./server.js";
export { DEFAULT_TOKEN_BUDGET, estimateTokens } from "./budget.js";
export type { Workspace, WorkspaceHandle } from "./workspace.js";
export { openWorkspace } from "./workspace.js";
