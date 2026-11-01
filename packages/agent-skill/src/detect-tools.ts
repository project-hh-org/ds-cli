import fs from "node:fs/promises";
import path from "node:path";

export type AiTool = "claude-code" | "codex" | "cursor" | "gemini" | "agents-md";

/** 표시·정렬 순서. */
export const AI_TOOLS: readonly AiTool[] = ["claude-code", "codex", "cursor", "gemini", "agents-md"];

export interface ToolDetection {
  tools: AiTool[];
  /** 도구별로 찾은 흔적. 레포 안은 `.claude/`, 홈은 `~/.claude/` 꼴. */
  evidence: Partial<Record<AiTool, string[]>>;
  /** 흔적이 하나도 없어 기본값(claude-code + agents-md)을 쓴 경우 true. */
  defaulted: boolean;
}

interface Trace {
  tool: AiTool;
  entry: string;
  kind: "dir" | "file";
}

const REPO_TRACES: Trace[] = [
  { tool: "claude-code", entry: ".claude", kind: "dir" },
  { tool: "claude-code", entry: "CLAUDE.md", kind: "file" },
  { tool: "cursor", entry: ".cursor", kind: "dir" },
  { tool: "gemini", entry: ".gemini", kind: "dir" },
  { tool: "codex", entry: ".agents", kind: "dir" },
  // AGENTS.md는 agents-md 렌더러가 쓰는 파일이라 Codex 증거로 치지 않는다 — 첫 install이 만든 파일이 두 번째 install의
  // 감지 결과를 바꾸면 멱등이 깨진다.
  { tool: "agents-md", entry: "AGENTS.md", kind: "file" },
  { tool: "codex", entry: ".codex", kind: "dir" },
];

const HOME_TRACES: Trace[] = [
  { tool: "claude-code", entry: ".claude", kind: "dir" },
  { tool: "codex", entry: ".codex", kind: "dir" },
  { tool: "cursor", entry: ".cursor", kind: "dir" },
  { tool: "gemini", entry: ".gemini", kind: "dir" },
];

async function exists(base: string, t: Trace): Promise<boolean> {
  try {
    const stat = await fs.stat(path.join(base, t.entry));
    return t.kind === "dir" ? stat.isDirectory() : stat.isFile();
  } catch {
    return false;
  }
}

/** codex가 있으면 agents-md를 더한다(AGENTS.md 블록은 agents-md 렌더러만 쓴다). AI_TOOLS 순서로 정렬하고 중복을 없앤다. */
export function normalizeTools(tools: AiTool[]): AiTool[] {
  const set = new Set<AiTool>(tools);
  if (set.has("codex")) set.add("agents-md");
  return AI_TOOLS.filter((t) => set.has(t));
}

/** 레포(`root`)와 사용자 홈(`home`)에서 쓰는 AI 도구의 흔적을 찾는다. */
export async function detectTools(root: string, home: string): Promise<ToolDetection> {
  const evidence: Partial<Record<AiTool, string[]>> = {};
  const add = (tool: AiTool, label: string): void => {
    (evidence[tool] ??= []).push(label);
  };
  for (const t of REPO_TRACES) if (await exists(root, t)) add(t.tool, t.kind === "dir" ? `${t.entry}/` : t.entry);
  for (const t of HOME_TRACES) if (await exists(home, t)) add(t.tool, `~/${t.entry}/`);

  const found = Object.keys(evidence) as AiTool[];
  if (found.length === 0) return { tools: ["claude-code", "agents-md"], evidence, defaulted: true };
  return { tools: normalizeTools(found), evidence, defaulted: false };
}
