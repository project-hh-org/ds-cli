import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { indexRepo, writeIndex } from "@dsmith-dev/core";
import { detect, readDetect, writeDetect } from "@dsmith-dev/detect";
import { metaOf, type Extractor } from "@dsmith-dev/extractor-api";
import { cssExtractor } from "@dsmith-dev/extractor-css";
import { emotionExtractor } from "@dsmith-dev/extractor-emotion";
import { inlineStyleExtractor } from "@dsmith-dev/extractor-inline-style";
import { muiSxExtractor } from "@dsmith-dev/extractor-mui-sx";
import { styledExtractor } from "@dsmith-dev/extractor-styled";
import { tailwindExtractor } from "@dsmith-dev/extractor-tailwind";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const ALL_EXTRACTORS: Extractor[] = [
  inlineStyleExtractor,
  tailwindExtractor,
  cssExtractor,
  styledExtractor,
  emotionExtractor,
  muiSxExtractor,
];

/** fixtures|examples/<name> → 임시 디렉터리 복사(.dsmith 제외). overlay = 상대 경로 → 파일 내용 */
export function copyFixture(rel: string, overlay: Record<string, string> = {}): string {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-init-")));
  fs.cpSync(path.join(REPO_ROOT, rel), tmp, {
    recursive: true,
    filter: (p) => !p.split(path.sep).includes(".dsmith"),
  });
  for (const [file, content] of Object.entries(overlay)) {
    const target = path.join(tmp, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf-8");
  }
  return tmp;
}

/** detect → indexRepo → 재detect → writeIndex·writeDetect (cli audit과 같은 절차) */
export async function auditFixture(root: string): Promise<void> {
  const available = ALL_EXTRACTORS.map(metaOf);
  const provisional = await detect(root, undefined, { available });
  await writeDetect(root, provisional);
  const index = await indexRepo(
    root,
    ALL_EXTRACTORS.filter((e) => provisional.activeExtractors.includes(e.name)),
  );
  await writeIndex(root, index);
  await writeDetect(root, await detect(root, index, { available }));
}

/** 상태 0 강제: overrides로 DS 없음 → 다시 audit */
export async function forceStateZero(root: string): Promise<void> {
  const current = await readDetect(root);
  if (current === null) throw new Error("먼저 auditFixture");
  await writeDetect(root, { ...current, overrides: { ds: { kind: "none", tokenFiles: [] }, state: 0 } });
  await auditFixture(root);
}

/** 경로+내용 해시. `.dsmith/reports`는 뺀다 */
export function treeHash(root: string): string {
  const hash = createHash("sha256");
  const walk = (dir: string, prefix: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const rel = `${prefix}${e.name}`;
      if (rel === ".dsmith/reports") continue;
      if (e.isDirectory()) walk(path.join(dir, e.name), `${rel}/`);
      else hash.update(rel).update("\0").update(fs.readFileSync(path.join(dir, e.name))).update("\0");
    }
  };
  walk(root, "");
  return hash.digest("hex");
}

export function listFiles(root: string, sub = ""): string[] {
  const dir = path.join(root, sub);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = sub === "" ? e.name : `${sub}/${e.name}`;
    return e.isDirectory() ? listFiles(root, rel) : [rel];
  });
}
