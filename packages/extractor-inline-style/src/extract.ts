import { parseTsx, traverse, usagesFromStyleObject } from "@dsmith/core";
import { JS_FILES } from "@dsmith/extractor-api";
import type { ExtractContext, Extractor, StyleUsage } from "@dsmith/extractor-api";
import { registerPatchTarget, write } from "./write.js";

export const EXTRACTOR_NAME = "inline-style";

function extract(ctx: ExtractContext): StyleUsage[] {
  // 복구 불가능한 문법 오류는 그대로 던진다. 파일 단위 실패 기록은 호출자(indexer) 몫이다.
  const ast = parseTsx(ctx.code, ctx.file);

  const usages: StyleUsage[] = [];
  traverse(ast, {
    JSXAttribute(path) {
      const { name, value } = path.node;
      if (name.type !== "JSXIdentifier" || name.name !== "style") return;
      if (value?.type !== "JSXExpressionContainer") return;
      if (value.expression.type !== "ObjectExpression") return;

      const objectCtx = { file: ctx.file, code: ctx.code, extractor: EXTRACTOR_NAME };
      for (const { usage, patch } of usagesFromStyleObject(value.expression, objectCtx)) {
        if (patch !== null) registerPatchTarget(usage, { ...patch, file: ctx.file });
        usages.push(usage);
      }
    },
  });
  return usages;
}

export const inlineStyleExtractor: Extractor = {
  name: EXTRACTOR_NAME,
  files: JS_FILES,
  parses: "tsx",
  appliesTo: (ctx) => /\.[cm]?[jt]sx?$/.test(ctx.file) && ctx.code.includes("style="),
  extract,
  write,
};
