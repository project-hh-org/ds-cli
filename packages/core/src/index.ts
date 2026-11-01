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
export type { ExtractorMatcher, FileStyles } from "./index/extract-file.js";
export { extractFileStyles, extractorMatchers } from "./index/extract-file.js";
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
export type { RankedToken, TokenMatch } from "./match/token-matcher.js";
export { matchToken, rankTokens } from "./match/token-matcher.js";
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
export type { ComponentSummary, LocalDefinition } from "./component/summary.js";
export { duplicateNames, localDefinitionFiles, localDefinitionsOf, summarizeComponents } from "./component/summary.js";
export type {
  ManagedRegion,
  PlannedWrite,
  SafeWriteOptions,
  SafeWriteResult,
  WriteManifest,
  WriteOutcome,
  WriteStatus,
} from "./fs/safe-write.js";
export { regionKey, safeWrite } from "./fs/safe-write.js";
export { DEFINITION_EXTENSIONS, resolveDefinitionFile } from "./component/definition.js";
export type { ComponentProps, PropInfo } from "./component/props.js";
export { readComponentProps } from "./component/props.js";
export type { ComponentMatch } from "./component/search.js";
export { COMPONENT_SYNONYMS, searchComponents } from "./component/search.js";
export { collectCssVariables, readCssVariableTokens } from "./tokens/css-variables.js";
export { proposalTokens } from "./tokens/proposal.js";
export type { LoadedToken, LoadedTokens, TokenSourceKind } from "./tokens/load.js";
export { loadTokens, tokenCategoryOf } from "./tokens/load.js";
export type {
  Confidence,
  DecisionCard,
  DecisionKind,
  DecisionListItem,
  DecisionOption,
  DecisionRecord,
  DecisionsFile,
  DifferenceAspect,
  GitHistory,
} from "./decisions/model.js";
export { readDecisions, recordDecision, writeDecisions } from "./decisions/store.js";
export type { DecisionCandidate } from "./decisions/candidates.js";
export { candidatesOf, decisionCandidates, listDecisions, similarItems } from "./decisions/candidates.js";
export { readGitHistory } from "./decisions/git-history.js";
export type { CardInput } from "./decisions/card.js";
export { buildDecisionCard } from "./decisions/card.js";
export type { ExplainOptions, ExplainResult } from "./decisions/explain.js";
export { DEFAULT_MAX_OPTIONS, explainDecision } from "./decisions/explain.js";
export type { ChooseOptions } from "./decisions/choose.js";
export { chooseDecision } from "./decisions/choose.js";
export type { FontSizeCluster } from "./cluster/font-size.js";
export { clusterFontSizes } from "./cluster/font-size.js";
export { colorTokenNames, uniqueNames } from "./cluster/names.js";
export { localDate } from "./util/local-date.js";
export type {
  Coverage,
  DraftCategory,
  DraftGroup,
  DraftOptions,
  DraftToken,
  ScaleMapping,
  TokenDraft,
} from "./tokens/draft.js";
export { COVERAGE_PROPERTIES, buildTokenDraft, draftCoverage, draftToTokens } from "./tokens/draft.js";
export type { ComponentDoc } from "./component/props.js";
export { readComponentDoc, readTypeProps } from "./component/props.js";
export { moduleOfFile } from "./component/definition.js";
export type {
  Catalog,
  CatalogComponent,
  CatalogOrigin,
  CatalogProp,
  CatalogSource,
  CatalogToken,
} from "./catalog/model.js";
export { CATALOG_FILE, readCatalog, writeCatalog } from "./catalog/store.js";
export type { DsmithExtension, W3cColorValue, W3cDimensionValue, W3cReadResult } from "./tokens/w3c.js";
export { DSMITH_EXTENSION, draftToW3c, readW3cTokens, serializeW3c } from "./tokens/w3c.js";
export { GENERATED_NOTICE, emitTokensCss, emitTokensTs } from "./tokens/emit.js";
export type { ComponentDeclaration } from "./component/declarations.js";
export { componentDeclarations } from "./component/declarations.js";
