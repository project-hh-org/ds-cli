import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { indexRepo, writeIndex } from "@dsmith-dev/core";
import { detect, readDetect, writeDetect, type DetectResult } from "@dsmith-dev/detect";
import { metaOf, type Extractor } from "@dsmith-dev/extractor-api";
import { cssExtractor } from "@dsmith-dev/extractor-css";
import { emotionExtractor } from "@dsmith-dev/extractor-emotion";
import { inlineStyleExtractor } from "@dsmith-dev/extractor-inline-style";
import { muiSxExtractor } from "@dsmith-dev/extractor-mui-sx";
import { styledExtractor } from "@dsmith-dev/extractor-styled";
import { tailwindExtractor } from "@dsmith-dev/extractor-tailwind";
import { runInit } from "@dsmith-dev/init";
import { runGuardInit, type GuardInitResult } from "../src/index.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const ALL: Extractor[] = [
  inlineStyleExtractor,
  tailwindExtractor,
  cssExtractor,
  styledExtractor,
  emotionExtractor,
  muiSxExtractor,
];

export const ESLINT_CONFIG = `import js from "@eslint/js";

export default [
  js.configs.recommended,
  { rules: { "no-unused-vars": "warn" } },
];
`;

const tmps: string[] = [];
export function cleanupTmps(): void {
  for (const t of tmps.splice(0)) fs.rmSync(t, { recursive: true, force: true });
}

export function tmpDir(prefix = "dsmith-guard-"): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmps.push(dir);
  return dir;
}

export function copyFixture(rel: string, overlay: Record<string, string> = {}): string {
  const tmp = tmpDir();
  fs.cpSync(path.join(REPO_ROOT, rel), tmp, { recursive: true, filter: (p) => !p.split(path.sep).includes(".dsmith") });
  for (const [file, content] of Object.entries(overlay)) {
    fs.mkdirSync(path.dirname(path.join(tmp, file)), { recursive: true });
    fs.writeFileSync(path.join(tmp, file), content, "utf-8");
  }
  return tmp;
}

export function makeRepo(files: Record<string, string>): string {
  const tmp = tmpDir();
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(tmp, file)), { recursive: true });
    fs.writeFileSync(path.join(tmp, file), content, "utf-8");
  }
  return tmp;
}

/** detect → indexRepo → 재detect → writeIndex·writeDetect (cli audit과 같은 절차) */
export async function audit(root: string): Promise<DetectResult> {
  const available = ALL.map(metaOf);
  const provisional = await detect(root, undefined, { available });
  await writeDetect(root, provisional);
  const index = await indexRepo(root, ALL.filter((e) => provisional.activeExtractors.includes(e.name)));
  await writeIndex(root, index);
  const final = await detect(root, index, { available });
  await writeDetect(root, final);
  return final;
}

export function treeHash(root: string, opts: { includeDsmith?: boolean } = {}): string {
  const hash = createHash("sha256");
  const walk = (dir: string, prefix: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const rel = `${prefix}${e.name}`;
      if (opts.includeDsmith !== true && rel === ".dsmith") continue;
      if (rel === ".git") continue;
      if (e.isDirectory()) walk(path.join(dir, e.name), `${rel}/`);
      else hash.update(rel).update("\0").update(fs.readFileSync(path.join(dir, e.name))).update("\0");
    }
  };
  walk(root, "");
  return hash.digest("hex");
}

export function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], {
    cwd: root,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function commitAll(root: string, message: string): void {
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", message);
}

export function read(root: string, file: string): string {
  return fs.readFileSync(path.join(root, file), "utf-8");
}

export function write(root: string, file: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content, "utf-8");
}

/** legacy-demo 복사 + eslint.config.mjs → audit → init --all → audit */
export async function preparedDemo(): Promise<{ root: string; detect: DetectResult }> {
  const root = copyFixture("examples/legacy-demo", { "eslint.config.mjs": ESLINT_CONFIG });
  await audit(root);
  await runInit({ root, version: "0.1.0", all: true });
  const final = await audit(root);
  return { root, detect: final };
}

/** 위 + guard init --ci github → git init·커밋("base")·main 브랜치 */
export async function baseRepo(): Promise<{ root: string; init: GuardInitResult }> {
  const { root, detect: d } = await preparedDemo();
  const init = await runGuardInit({ root, version: "0.1.0", detect: d, ci: "github" });
  git(root, "init", "-q", "-b", "main");
  commitAll(root, "base");
  return { root, init };
}

/** 커밋까지 포함해 저장소를 통째로 복사한다(.git 포함) */
export function cloneRepo(from: string): string {
  const to = tmpDir();
  fs.cpSync(from, to, { recursive: true });
  return to;
}

export async function detectOf(root: string): Promise<DetectResult> {
  const d = await readDetect(root);
  if (d === null) throw new Error("먼저 audit");
  return d;
}

/** 테스트 파일 전체에서 쓰는 디렉터리는 afterEach 정리에서 뺀다(호출자가 afterAll에서 지운다) */
export function keep(dir: string): string {
  const i = tmps.indexOf(dir);
  if (i >= 0) tmps.splice(i, 1);
  return dir;
}
