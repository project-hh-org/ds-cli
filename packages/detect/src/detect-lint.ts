import fs from "node:fs/promises";
import path from "node:path";
import { pathExists } from "./fs-utils.js";

export interface LintDetection {
  tool: "eslint" | "oxlint" | "biome" | "none";
  configFile?: string;
}

const ESLINT_FLAT = ["js", "mjs", "cjs", "ts"].map((e) => `eslint.config.${e}`);
const OXLINT = [".oxlintrc.json"];
const BIOME = ["biome.json", "biome.jsonc"];

async function firstExisting(root: string, names: string[]): Promise<string | undefined> {
  for (const n of names) if (await pathExists(path.join(root, n))) return n;
  return undefined;
}

export async function detectLint(root: string): Promise<LintDetection> {
  const flat = await firstExisting(root, ESLINT_FLAT);
  if (flat) return { tool: "eslint", configFile: flat };

  // 레거시 설정: .eslintrc, .eslintrc.json, .eslintrc.cjs ...
  const rc = (await fs.readdir(root)).filter((n) => /^\.eslintrc(?:\..+)?$/.test(n)).sort()[0];
  if (rc) return { tool: "eslint", configFile: rc };

  const ox = await firstExisting(root, OXLINT);
  if (ox) return { tool: "oxlint", configFile: ox };

  const biome = await firstExisting(root, BIOME);
  if (biome) return { tool: "biome", configFile: biome };

  return { tool: "none" };
}
