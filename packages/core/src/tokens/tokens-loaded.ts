import fs from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { DEFAULT_EXCLUDE } from "../index/indexer.js";
import { stripComments } from "./tailwind-preset.js";

/**
 * init이 쓴 `<initDir>/tokens.css`를 어딘가에서 불러오는가 — migrate가 쓴 `var(--…)`가 값을 가지려면 전역에 로드돼 있어야 한다.
 * css = JS/TS `import "…/tokens.css"`, CSS `@import`, HTML `<link href>` 중 하나라도 있음.
 * evidence = 그 파일(root 상대). 없으면 null.
 */
export interface TokensStylesheetLoaded {
  css: boolean;
  evidence: string | null;
}

export const TOKENS_NOT_LOADED_NOTE = (initDir: string): string =>
  `토큰 스타일시트가 로드되지 않음: ${initDir === "." ? "" : `${initDir}/`}tokens.css를 전역 엔트리(예: app/layout.tsx, src/main.tsx, globals.css)에서 import하세요 — 치환된 var()가 비어 보입니다`;

const SOURCE_GLOB = "**/*.{css,scss,sass,less,html,htm,js,jsx,ts,tsx,mjs,cjs,mts,cts,vue,svelte,astro,mdx}";
const STYLE_EXT = /\.(?:css|scss|sass|less)$/;
const MARKUP_EXT = /\.(?:html|htm|vue|svelte|astro|mdx)$/;

/** import·from·require·@import·url()·href·src 바로 뒤의 문자열이 `tokens.css`로 끝나는 지정자 */
const SPECIFIER = /(?:\bimport\s*\(?\s*|\bfrom\s*|\brequire\(\s*|@import\s+(?:url\(\s*)?|\burl\(\s*|\bhref\s*=\s*|\bsrc\s*=\s*)(["'])([^"'\n]*?tokens\.css(?:[?#][^"'\n]*)?)\1/g;

function specifiersIn(file: string, text: string): string[] {
  const body = STYLE_EXT.test(file) ? stripComments(text, "css") : MARKUP_EXT.test(file) ? stripComments(text.replace(/<!--[\s\S]*?-->/g, ""), "css") : stripComments(text);
  return [...body.matchAll(SPECIFIER)].map((m) => m[2] ?? "");
}

/** `target`(root 상대 POSIX, 예 "design-system/tokens.css")을 가리키는 지정자인가. 상대 경로는 파일 위치 기준, 그 밖(별칭·절대)은 끝 경로로 판정 */
function pointsAt(spec: string, fileDir: string, target: string): boolean {
  const clean = spec.replace(/[?#].*$/, "");
  if (clean.startsWith(".")) return path.posix.normalize(path.posix.join(fileDir, clean)) === target;
  const bare = clean.replace(/^\/+/, "");
  if (bare === target || clean.endsWith(`/${target}`)) return true;
  const tail = target.split("/").slice(-2).join("/");
  return clean.endsWith(`/${tail}`) || bare === tail;
}

/**
 * root 아래(기본 제외·`exclude` 밖)의 파일 중 `<initDir>/tokens.css`를 불러오는 첫 파일(경로순)을 찾는다.
 * initDir 안의 파일은 세지 않는다 — 단, `themeLinked`(Tailwind v4 테마 파일이 진입 CSS에 연결됨)면 그 안의 CSS(tailwind.theme.css 등)가
 * tokens.css를 import하는 것은 센다. 파일은 읽기만 한다.
 */
export async function findTokensStylesheetImport(
  root: string,
  opts: { initDir: string; themeLinked?: boolean; exclude?: string[] },
): Promise<TokensStylesheetLoaded> {
  const target = opts.initDir === "." ? "tokens.css" : `${opts.initDir}/tokens.css`;
  const files = (await fg([SOURCE_GLOB], { cwd: root, ignore: [...DEFAULT_EXCLUDE, ...(opts.exclude ?? [])], dot: false }))
    .map((f) => f.split(path.sep).join("/"))
    .sort();
  for (const file of files) {
    if (file === target) continue;
    const inInitDir = opts.initDir === "." ? !file.includes("/") : file.startsWith(`${opts.initDir}/`);
    if (inInitDir && !(opts.themeLinked === true && STYLE_EXT.test(file))) continue;
    let text: string;
    try {
      text = await fs.readFile(path.join(root, file), "utf-8");
    } catch {
      continue;
    }
    if (!text.includes("tokens.css")) continue;
    const dir = path.posix.dirname(file);
    if (specifiersIn(file, text).some((s) => pointsAt(s, dir === "." ? "" : dir, target))) return { css: true, evidence: file };
  }
  return { css: false, evidence: null };
}
