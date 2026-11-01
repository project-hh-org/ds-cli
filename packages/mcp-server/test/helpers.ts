import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { indexRepo, writeIndex } from "@dsmith-dev/core";
import { detect, writeDetect } from "@dsmith-dev/detect";
import { metaOf, type Extractor } from "@dsmith-dev/extractor-api";
import { cssExtractor } from "@dsmith-dev/extractor-css";
import { emotionExtractor } from "@dsmith-dev/extractor-emotion";
import { inlineStyleExtractor } from "@dsmith-dev/extractor-inline-style";
import { muiSxExtractor } from "@dsmith-dev/extractor-mui-sx";
import { styledExtractor } from "@dsmith-dev/extractor-styled";
import { tailwindExtractor } from "@dsmith-dev/extractor-tailwind";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createDsmithServer, type ServerDeps } from "../src/index.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** lint_snippet 테스트용: 레지스트리의 여섯 Extractor 전부 */
export const ALL_EXTRACTORS: Extractor[] = [
  inlineStyleExtractor,
  tailwindExtractor,
  cssExtractor,
  styledExtractor,
  emotionExtractor,
  muiSxExtractor,
];

/** fixtures|examples/<name> → 임시 디렉터리 복사(.dsmith 제외). overlay = 상대 경로 → 파일 내용 */
export function copyFixture(rel: string, overlay: Record<string, string> = {}): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-mcp-"));
  fs.cpSync(path.join(REPO_ROOT, rel), tmp, {
    recursive: true,
    filter: (p) => !p.split(path.sep).includes(".dsmith"),
  });
  for (const [file, content] of Object.entries(overlay)) {
    const target = path.join(tmp, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf-8");
  }
  return tmp;
}

/** 테스트용 ensureIndex: indexRepo + detect(available: 6종 메타) + writeIndex/writeDetect */
export async function indexFixture(root: string): Promise<void> {
  const available = ALL_EXTRACTORS.map(metaOf);
  const provisional = await detect(root, undefined, { available });
  const index = await indexRepo(
    root,
    ALL_EXTRACTORS.filter((e) => provisional.activeExtractors.includes(e.name)),
  );
  await writeIndex(root, index);
  await writeDetect(root, await detect(root, index, { available }));
}

export const WITH_DS_TOKENS_CSS = `:root {\n  --color-primary: #3b82f6;\n  --color-text: #111111;\n  --space-2: 8px;\n  --radius-md: 6px;\n}\n`;

export async function connect(deps: Partial<ServerDeps> & { root: string }): Promise<Client> {
  const server = await createDsmithServer({
    version: "0.0.0-test",
    extractors: ALL_EXTRACTORS,
    ensureIndex: indexFixture,
    log: () => {},
    ...deps,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);
  return client;
}

/** content[0].text를 JSON으로 파싱한다. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function json(result: { content: unknown }): any {
  const content = result.content as { type: string; text?: string }[];
  const first = content[0];
  if (first?.type !== "text" || first.text === undefined) throw new Error("text content가 아님");
  return JSON.parse(first.text);
}

export function textOf(result: { content: unknown }): string {
  const content = result.content as { type: string; text?: string }[];
  return content[0]?.text ?? "";
}
