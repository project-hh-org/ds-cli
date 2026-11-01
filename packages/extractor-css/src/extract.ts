import { classifyDeclaration, lineLocator, parseCssDeclarations } from "@dsmith/core";
import type { ExtractContext, Extractor, StyleUsage } from "@dsmith/extractor-api";
import { registerPatchTarget, write } from "./write.js";

export const EXTRACTOR_NAME = "css";

function extract(ctx: ExtractContext): StyleUsage[] {
  const lineOf = lineLocator(ctx.code);
  const usages: StyleUsage[] = [];

  const lineComments = /\.scss$/.test(ctx.file);
  for (const decl of parseCssDeclarations(ctx.code, 0, { lineComments })) {
    const result = classifyDeclaration(decl, {
      file: ctx.file,
      extractor: EXTRACTOR_NAME,
      code: ctx.code,
      lineOf,
    });
    if (result === null) continue;
    if (result.patch !== null) registerPatchTarget(result.usage, { ...result.patch, file: ctx.file });
    usages.push(result.usage);
  }
  return usages;
}

/** CSS Modules(`*.module.css`)는 JS 쪽 import와 함께 봐야 하므로 이 추출기 대상이 아니다. */
function appliesTo(ctx: ExtractContext): boolean {
  const base = ctx.file.split(/[\\/]/).pop() ?? ctx.file;
  return /\.(css|scss)$/.test(base) && !base.includes(".module.");
}

export const cssExtractor: Extractor = {
  name: EXTRACTOR_NAME,
  files: ["**/*.{css,scss}"],
  parses: "none",
  signals: { files: ["**/*.{css,scss}", "!**/*.module.{css,scss}"] },
  appliesTo,
  extract,
  write,
};
