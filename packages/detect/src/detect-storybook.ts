import path from "node:path";
import { isDir, listFiles } from "./fs-utils.js";

export async function detectStorybook(root: string, exclude: string[] = []): Promise<boolean> {
  if (await isDir(path.join(root, ".storybook"))) return true;
  return (await listFiles(root, ["**/*.stories.{tsx,jsx,ts,js,mdx}"], exclude)).length > 0;
}
