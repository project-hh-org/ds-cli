import { parseTsx, traverse, usagesFromStyleObject } from "@dsmith-dev/core";
import { JS_FILES } from "@dsmith-dev/extractor-api";
import type { ExtractContext, Extractor, StyleUsage } from "@dsmith-dev/extractor-api";
import { registerPatchTarget, tokenRef, write } from "./write.js";

export const EXTRACTOR_NAME = "inline-style";

const REFERENCE_TYPES: ReadonlySet<string> = new Set([
  "MemberExpression",
  "OptionalMemberExpression",
  "CallExpression",
  "OptionalCallExpression",
]);

/** 다른 곳에 정의된 스타일을 가리키는 값(`s`, `styles.box`, `styles?.x`, `getStyle()`). `undefined`는 제외. */
function isStyleReference(node: { type: string; name?: unknown }): boolean {
  if (node.type === "Identifier") return node.name !== "undefined";
  return REFERENCE_TYPES.has(node.type);
}

function extract(ctx: ExtractContext): StyleUsage[] {
  // 복구 불가능한 문법 오류는 그대로 던진다. 파일 단위 실패 기록은 호출자(indexer) 몫이다.
  const ast = parseTsx(ctx.code, ctx.file);

  const usages: StyleUsage[] = [];
  traverse(ast, {
    JSXAttribute(path) {
      const { name, value } = path.node;
      if (name.type !== "JSXIdentifier" || name.name !== "style") return;
      if (value?.type !== "JSXExpressionContainer") return;
      const expr = value.expression;
      if (isStyleReference(expr)) {
        // `style={styles.box}`: 값을 알 수 없지만 커버리지에서 빠지지 않도록 dynamic 한 건으로 센다.
        const { start, end, loc } = expr;
        if (start == null || end == null || loc == null) return;
        usages.push({
          file: ctx.file,
          line: loc.start.line,
          column: loc.start.column,
          property: "other",
          raw: ctx.code.slice(start, end),
          normalized: { kind: "unknown" },
          source: "dynamic",
          extractor: EXTRACTOR_NAME,
        });
        return;
      }
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
  signals: { code: "style=\\{\\{" },
  appliesTo: (ctx) => /\.[cm]?[jt]sx?$/.test(ctx.file) && ctx.code.includes("style="),
  extract,
  write,
  tokenRef,
};
