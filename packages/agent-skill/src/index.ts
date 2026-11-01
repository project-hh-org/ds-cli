import type { AiTool } from "./detect-tools.js";
import { agentsMdRenderer } from "./renderers/agents-md.js";
import { claudeCodeRenderer } from "./renderers/claude-code.js";
import { codexRenderer } from "./renderers/codex.js";
import { cursorRenderer } from "./renderers/cursor.js";
import { geminiRenderer } from "./renderers/gemini.js";
import type { Renderer } from "./renderers/shared.js";

export type { CommandSource } from "./commands.js";
export { COMMANDS_DIR, loadCommands } from "./commands.js";
export type { AiTool, ToolDetection } from "./detect-tools.js";
export { AI_TOOLS, detectTools, normalizeTools } from "./detect-tools.js";
export type { McpLaunch } from "./mcp-launch.js";
export { defaultMcpLaunch, parseMcpCommand } from "./mcp-launch.js";
export type { RenderContext, RenderOutput, Renderer } from "./renderers/shared.js";
export { DEFAULT_CLI, MANAGED_NOTICE, MD_MARKERS, TOML_MARKERS, mcpServerEntry, substituteArgs } from "./renderers/shared.js";

export const renderers: Record<AiTool, Renderer> = {
  "claude-code": claudeCodeRenderer,
  codex: codexRenderer,
  cursor: cursorRenderer,
  gemini: geminiRenderer,
  "agents-md": agentsMdRenderer,
};
