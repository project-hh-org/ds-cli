import { JS_FILES } from "@dsmith-dev/extractor-api";
import type { Extractor } from "@dsmith-dev/extractor-api";
import { extractCssInJs, type Owned, type StyleImports } from "@dsmith-dev/extractor-styled";
import { write } from "./write.js";

export const EXTRACTOR_NAME = "emotion";

/**
 * emotion 귀속: `@emotion/styled`의 `styled`, `@emotion/react`·`@emotion/css`의 `css`, JSX `css` prop.
 * styled-components만 import한 파일의 `css` prop은 styled-components 쪽 문법이므로 보지 않는다.
 */
function ownedByEmotion(imports: StyleImports): Owned {
  const styled = imports.emotionStyled === null ? [] : [imports.emotionStyled];
  const tags = imports.emotionCss === null ? [] : [imports.emotionCss];
  return {
    styled: new Set(styled),
    tags: new Set(tags),
    cssProp: imports.fromEmotion || !imports.fromStyledComponents,
  };
}

const JS_FILE = /\.[cm]?[jt]sx?$/;

export const emotionExtractor: Extractor = {
  name: EXTRACTOR_NAME,
  files: JS_FILES,
  parses: "tsx",
  signals: { dependencies: ["@emotion/react", "@emotion/styled", "@emotion/css"] },
  appliesTo: (ctx) => JS_FILE.test(ctx.file) && (ctx.code.includes("@emotion/") || ctx.code.includes("css={")),
  extract: (ctx) => extractCssInJs(ctx, EXTRACTOR_NAME, ownedByEmotion),
  write,
};
