import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { indexRepo, readIndex, writeIndex } from "@dsmith-dev/core";
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

/** 경로+내용 해시. 기본은 `.dsmith/`를 뺀다 */
export function treeHash(root: string, opts: { includeDsmith?: boolean } = {}): string {
  const hash = createHash("sha256");
  const walk = (dir: string, prefix: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const rel = `${prefix}${e.name}`;
      if (opts.includeDsmith === true ? false : rel === ".dsmith") continue;
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

export const ALL = ALL_EXTRACTORS;

/** 파일 맵으로 임시 레포를 만든다 */
export function makeRepo(files: Record<string, string>): string {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dsmith-migrate-")));
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(tmp, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf-8");
  }
  return tmp;
}

export function read(root: string, file: string): string {
  return fs.readFileSync(path.join(root, file), "utf-8");
}

export const TOKENS_CSS = ":root { --color-brand: #3b82f6; --space-4: 16px; --space-2: 8px; --radius-sm: 4px; --font-size-md: 14px; }\n";

/** css·inline·tailwind 파일과 토큰 파일이 있는 합성 레포 */
export function syntheticRepo(extra: Record<string, string> = {}): string {
  return makeRepo({
    "package.json": JSON.stringify({ name: "x", dependencies: { react: "18", tailwindcss: "3.4.0" } }),
    "styles/tokens.css": TOKENS_CSS,
    "src/a.css": ".a { color: #3b82f6; padding: 16px; border-radius: 4px; margin: 7px; width: 33px; }\n",
    "src/B.tsx": 'export const B = () => <div style={{ color: "#3b82f6", padding: 8, fontSize: 14 }} className="bg-[#3b82f6] p-[16px]" />;\n',
    "src/C.tsx": 'export const C = () => <p style={{ backgroundColor: "#3b82f6", margin: 24 }} />;\n',
    ...extra,
  });
}

export async function loadState(root: string) {
  const detect = (await readDetect(root))!;
  const index = (await readIndex(root))!;
  const extractors = ALL.filter((e) => detect.activeExtractors.includes(e.name));
  return { detect, index, extractors };
}
