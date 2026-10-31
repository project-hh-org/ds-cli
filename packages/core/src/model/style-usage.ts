import type { StyleUsage } from "@ds-cli/extractor-api";

export type { StyleProperty, StyleSource, StyleUsage } from "@ds-cli/extractor-api";

export type NormalizedColor = Extract<StyleUsage["normalized"], { kind: "color" }>;
