import path from "node:path";
import { isDir } from "./fs-utils.js";

export interface FrameworkDetection {
  name: "next" | "vite" | "react-native" | "unknown";
  router?: "app" | "pages";
}

async function anyDir(root: string, dirs: string[]): Promise<boolean> {
  for (const d of dirs) if (await isDir(path.join(root, d))) return true;
  return false;
}

export async function detectFramework(root: string, deps: string[]): Promise<FrameworkDetection> {
  const has = (name: string) => deps.includes(name);

  if (has("next")) {
    if (await anyDir(root, ["app", "src/app"])) return { name: "next", router: "app" };
    if (await anyDir(root, ["pages", "src/pages"])) return { name: "next", router: "pages" };
    return { name: "next" };
  }
  if (has("react-native") || has("expo")) return { name: "react-native" };
  if (has("vite")) return { name: "vite" };
  return { name: "unknown" };
}
