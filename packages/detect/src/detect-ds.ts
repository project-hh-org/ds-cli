import path from "node:path";
import { isDir, listFiles } from "./fs-utils.js";

export interface DsDetection {
  kind: "npm" | "local" | "none";
  packageName?: string;
  dir?: string;
  tokenFiles: string[];
}

const NPM_DS_PREFIXES = ["@radix-ui/", "@mantine/", "@chakra-ui/", "@mui/"];
const LOCAL_DS_DIRS = ["components/ui", "src/components/ui", "src/ui", "src/design-system", "packages/ui"];
const TOKEN_FILES = "**/{tokens.css,tokens.ts,tokens.json,theme.ts,theme.css,design-tokens.*}";

function isNpmDs(name: string): boolean {
  return (
    NPM_DS_PREFIXES.some((p) => name.startsWith(p)) ||
    name === "antd" ||
    name.includes("design-system") ||
    name.includes("ui-kit") ||
    name.endsWith("/ui")
  );
}

/** 의존성 이름 목록에서 DS로 보이는 첫 번째 패키지를 찾는다. */
export function findNpmDs(deps: string[]): string | undefined {
  return deps.find(isNpmDs);
}

export async function detectDs(root: string, deps: string[]): Promise<DsDetection> {
  const tokenFiles = await listFiles(root, [TOKEN_FILES]);

  const packageName = findNpmDs(deps);
  if (packageName !== undefined) return { kind: "npm", packageName, tokenFiles };

  for (const dir of LOCAL_DS_DIRS) {
    if (await isDir(path.join(root, dir))) return { kind: "local", dir, tokenFiles };
  }
  return { kind: "none", tokenFiles };
}

/** `./`, `../`, `@/`, `~/`, 선행 `/`, 선행 `src/`를 벗겨 별칭·상대경로 차이를 무시한다. */
function normalizeSpecifier(spec: string): string {
  return spec.replace(/^(?:\.{1,2}\/)+/, "").replace(/^[@~]?\//, "").replace(/^src\//, "");
}

/** import 지정자가 감지된 DS(npm 패키지 또는 로컬 디렉터리)를 가리키는지. */
export function isDsSpecifier(spec: string, ds: DsDetection): boolean {
  if (ds.kind === "npm" && ds.packageName !== undefined) {
    return spec === ds.packageName || spec.startsWith(`${ds.packageName}/`);
  }
  if (ds.kind === "local" && ds.dir !== undefined) {
    const dir = normalizeSpecifier(ds.dir);
    const s = normalizeSpecifier(spec);
    return s === dir || s.startsWith(`${dir}/`);
  }
  return false;
}
