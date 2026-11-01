export type {
  ExtractContext,
  Extractor,
  StyleProperty,
  StyleSource,
  StyleUsage,
  WritePatch,
} from "@dsmith-dev/extractor-api";
export type { NormalizedColor } from "./model/style-usage.js";
export { isRatedUsage } from "./model/style-usage.js";
export type { ComponentUsage } from "./model/component-usage.js";
export type { Token, TokenSet } from "./model/token.js";
export { normalizeColor } from "./normalize/color.js";
export { normalizeLength } from "./normalize/length.js";
export { parseTsx, traverse } from "./parse/tsx.js";
export type { Index, IndexOptions } from "./index/indexer.js";
export { DEFAULT_EXCLUDE, indexRepo } from "./index/indexer.js";
export type { ModuleContext } from "./index/component-usage.js";
export { extractComponentUsage } from "./index/component-usage.js";
export type { TsPaths } from "./index/specifier.js";
export {
  normalizePackageSpecifier,
  normalizeSpecifier,
  readTsconfigPaths,
  resolveWithPaths,
} from "./index/specifier.js";
export { readIndex, writeIndex } from "./index/store.js";
export { colorDistance, lengthDistance } from "./match/distance.js";
export type { ColorCluster } from "./cluster/color-cluster.js";
export { clusterColors } from "./cluster/color-cluster.js";
export type { SpacingCandidate } from "./cluster/spacing-cluster.js";
export { clusterSpacing } from "./cluster/spacing-cluster.js";
export type { TokenMatch } from "./match/token-matcher.js";
export { matchToken } from "./match/token-matcher.js";
export {
  COLOR_PROPERTIES,
  LENGTH_PROPERTIES,
  cssPropertyToStyleProperty,
  isColorProperty,
  isLengthProperty,
  splitShorthandColor,
} from "./model/css-property.js";
export type { CssDecl } from "./parse/css-text.js";
export { PLACEHOLDER, parseCssDeclarations } from "./parse/css-text.js";
export type { ClassifyOptions } from "./parse/css-decl-usage.js";
export { classifyDeclaration, lineLocator } from "./parse/css-decl-usage.js";
export type { StyleObjectContext, StyleObjectPatch, StyleObjectUsage } from "./parse/object-style.js";
export { usagesFromStyleObject } from "./parse/object-style.js";
