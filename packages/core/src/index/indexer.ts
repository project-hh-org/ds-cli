import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import type { ExtractContext, Extractor, StyleUsage } from "@ds-cli/extractor-api";
import type { ComponentUsage } from "../model/component-usage.js";
import { parseTsx } from "../parse/tsx.js";
import { extractComponentUsage } from "./component-usage.js";

export interface Index {
  root: string;
  createdAt: string;
  extractors: string[];
  files: { scanned: number; skipped: { file: string; reason: string }[] };
  styles: StyleUsage[];
  components: ComponentUsage[];
}

export interface IndexOptions {
  include?: string[];
  exclude?: string[];
}

const DEFAULT_INCLUDE = ["**/*.{tsx,jsx,ts,js}"];
const DEFAULT_EXCLUDE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.next/**",
  "**/build/**",
  "**/coverage/**",
  "**/.ds-cli/**",
];

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function indexRepo(
  root: string,
  extractors: Extractor[],
  opts: IndexOptions = {},
): Promise<Index> {
  const files = (
    await fg(opts.include ?? DEFAULT_INCLUDE, {
      cwd: root,
      ignore: opts.exclude ?? DEFAULT_EXCLUDE,
      absolute: false,
      dot: false,
    })
  )
    .map((f) => f.split(path.sep).join("/"))
    .sort();

  const index: Index = {
    root,
    createdAt: new Date().toISOString(),
    extractors: extractors.map((e) => e.name),
    files: { scanned: 0, skipped: [] },
    styles: [],
    components: [],
  };

  for (const file of files) {
    let code: string;
    try {
      code = await fs.readFile(path.join(root, file), "utf-8");
    } catch (err) {
      index.files.skipped.push({ file, reason: `read: ${messageOf(err)}` });
      continue;
    }

    // 한 파일의 결과는 모두 성공했을 때만 인덱스에 반영한다(부분 결과가 남지 않게).
    try {
      const ctx: ExtractContext = { root, file, code };
      const styles: StyleUsage[] = [];
      for (const extractor of extractors) {
        if (!extractor.appliesTo(ctx)) continue;
        for (const usage of extractor.extract(ctx)) {
          // WeakMap 키인 원본 객체를 그대로 유지해야 하므로 복제하지 않고 file만 맞춘다.
          usage.file = file;
          styles.push(usage);
        }
      }
      const components = extractComponentUsage(file, parseTsx(code, file));
      index.styles.push(...styles);
      index.components.push(...components);
      index.files.scanned += 1;
    } catch (err) {
      index.files.skipped.push({ file, reason: `parse: ${messageOf(err)}` });
    }
  }
  return index;
}
