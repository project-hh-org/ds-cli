import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** 경로+내용 해시. 기본은 `.dsmith/`를 뺀다 */
export function treeHash(root: string, opts: { includeDsmith?: boolean } = {}): string {
  const hash = createHash("sha256");
  const walk = (dir: string, prefix: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const rel = `${prefix}${e.name}`;
      if (opts.includeDsmith !== true && rel === ".dsmith") continue;
      if (e.isDirectory()) walk(path.join(dir, e.name), `${rel}/`);
      else hash.update(rel).update("\0").update(fs.readFileSync(path.join(dir, e.name))).update("\0");
    }
  };
  walk(root, "");
  return hash.digest("hex");
}
