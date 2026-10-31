import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";

/** core 인덱서와 같은 스캔 대상. */
export const SOURCE_INCLUDE = ["**/*.{tsx,jsx,ts,js}"];
/** core 인덱서의 기본 제외 목록과 동일하게 유지한다. */
export const EXCLUDE = [
  "**/node_modules/**",
  "**/dist/**",
  "**/.next/**",
  "**/build/**",
  "**/coverage/**",
  "**/.ds-cli/**",
];

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

/** 제외 목록을 적용해 root 기준 POSIX 경로를 정렬해서 돌려준다. */
export async function listFiles(root: string, patterns: string[]): Promise<string[]> {
  const files = await fg(patterns, { cwd: root, ignore: EXCLUDE, dot: false });
  return files.map((f) => f.split(path.sep).join("/")).sort();
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
  const json = JSON.parse(text) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return [...Object.keys(json.dependencies ?? {}), ...Object.keys(json.devDependencies ?? {})];
}

const READ_BATCH = 64;

/** 인덱서와 같은 glob의 소스 파일을 텍스트로 읽는다. 읽을 수 없는 파일은 건너뛴다. */
export async function loadSources(root: string): Promise<SourceFile[]> {
  const files = await listFiles(root, SOURCE_INCLUDE);
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
