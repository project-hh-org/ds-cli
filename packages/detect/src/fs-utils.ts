import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_EXCLUDE } from "@dsmith-dev/core";
import fg from "fast-glob";

/** core 인덱서와 같은 스캔 대상. */
export const SOURCE_INCLUDE = ["**/*.{tsx,jsx,ts,js}"];

export interface SourceFile {
  /** 루트 기준 POSIX 경로 */
  file: string;
  content: string;
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

export async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** core 인덱서의 기본 제외(`DEFAULT_EXCLUDE`)와 `exclude`를 적용해 root 기준 POSIX 경로를 정렬해서 돌려준다. */
export async function listFiles(root: string, patterns: string[], exclude: string[] = []): Promise<string[]> {
  const files = await fg(patterns, { cwd: root, ignore: [...DEFAULT_EXCLUDE, ...exclude], dot: false });
  return files.map((f) => f.split(path.sep).join("/")).sort();
}

/** JSON을 파싱하고, 실패하면 파일 경로를 메시지에 담아 던진다. */
export function parseJsonFile(text: string, displayPath: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${displayPath}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
}

function keysOf(value: unknown): string[] {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? Object.keys(value) : [];
}

/** `package.json`의 dependencies, devDependencies 이름을 선언 순서대로 돌려준다. 파일이 없으면 빈 배열. */
export async function readDependencyNames(root: string): Promise<string[]> {
  let text: string;
  try {
    text = await fs.readFile(path.join(root, "package.json"), "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const json = parseJsonFile(text, "package.json");
  if (typeof json !== "object" || json === null) return [];
  const { dependencies, devDependencies } = json as Record<string, unknown>;
  return [...keysOf(dependencies), ...keysOf(devDependencies)];
}

/** 루트에 `pnpm-workspace.yaml`이 있거나 `package.json`에 `workspaces`가 있으면 모노레포 루트로 본다. */
export async function isMonorepoRoot(root: string): Promise<boolean> {
  if (await pathExists(path.join(root, "pnpm-workspace.yaml"))) return true;
  try {
    const json: unknown = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf-8"));
    return typeof json === "object" && json !== null && "workspaces" in json;
  } catch {
    // 없거나 손상된 package.json은 readDependencyNames가 따로 다룬다.
    return false;
  }
}

const READ_BATCH = 64;

/** 인덱서와 같은 glob의 소스 파일을 텍스트로 읽는다. 읽을 수 없는 파일은 건너뛴다. */
export async function loadSources(root: string, exclude: string[] = []): Promise<SourceFile[]> {
  return loadFiles(root, SOURCE_INCLUDE, exclude);
}

/** glob에 맞는 파일을 텍스트로 읽는다(경로 정렬순). 읽을 수 없는 파일은 건너뛴다. */
export async function loadFiles(root: string, patterns: string[], exclude: string[] = []): Promise<SourceFile[]> {
  const files = await listFiles(root, patterns, exclude);
  const out: SourceFile[] = [];
  for (let i = 0; i < files.length; i += READ_BATCH) {
    const batch = files.slice(i, i + READ_BATCH);
    const read = await Promise.all(
      batch.map(async (file) => {
        try {
          return { file, content: await fs.readFile(path.join(root, file), "utf-8") };
        } catch {
          return null;
        }
      }),
    );
    for (const r of read) if (r) out.push(r);
  }
  return out;
}
