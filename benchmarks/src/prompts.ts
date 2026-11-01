import fs from "node:fs/promises";
import path from "node:path";
import { sha256Text } from "@dsmith-dev/core";

export interface Prompt {
  id: string;
  /** 에이전트가 만들어야 하는 파일(복사본 root 상대 POSIX) */
  file: string;
  text: string;
  /** text의 sha256Text */
  sha256: string;
}

const ID = /^\d{2}-[a-z-]+$/;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

/** `---\nid: <id>\nfile: <path>\n---\n<본문>` — 본문은 앞뒤 공백을 자른 그대로. 어긋나면 Error(파일 이름 포함). */
export function parsePrompt(name: string, text: string): Prompt {
  const fail = (why: string): never => {
    throw new Error(`프롬프트 ${name}: ${why}`);
  };
  const m = FRONTMATTER.exec(text);
  if (m === null) return fail("frontmatter(---)가 없습니다");
  const meta = new Map<string, string>();
  for (const line of (m[1] ?? "").split(/\r?\n/)) {
    const kv = /^([a-z]+):\s*(.*?)\s*$/.exec(line);
    if (kv?.[1] !== undefined) meta.set(kv[1], kv[2] ?? "");
  }
  const id = meta.get("id");
  const file = meta.get("file");
  if (id === undefined || !ID.test(id)) return fail(`id가 ${ID} 형식이 아닙니다: ${id ?? "(없음)"}`);
  if (file === undefined || file === "") return fail("file이 없습니다");
  if (file.startsWith("/") || file.includes("\\") || file.split("/").some((s) => s === ".." || s === "." || s === "")) return fail(`file은 상대 POSIX 경로여야 합니다: ${file}`);
  const body = (m[2] ?? "").trim();
  if (body === "") return fail("본문이 비어 있습니다");
  if (!body.includes(file)) return fail(`본문에 file(${file})이 그대로 들어 있어야 합니다`);
  return { id, file, text: body, sha256: sha256Text(body) };
}

/** dir의 *.md를 이름 순으로. ids가 있으면 그 id만(없는 id는 Error). */
export async function loadPrompts(dir: string, ids?: string[]): Promise<Prompt[]> {
  const names = (await fs.readdir(dir)).filter((n) => n.endsWith(".md")).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const all: Prompt[] = [];
  for (const n of names) all.push(parsePrompt(n, await fs.readFile(path.join(dir, n), "utf-8")));
  if (ids === undefined) return all;
  const byId = new Map(all.map((p) => [p.id, p]));
  return ids.map((id) => {
    const p = byId.get(id);
    if (p === undefined) throw new Error(`알 수 없는 프롬프트 id: ${id} (있는 것: ${all.map((x) => x.id).join(", ")})`);
    return p;
  });
}
