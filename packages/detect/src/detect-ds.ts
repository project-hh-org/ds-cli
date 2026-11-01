import path from "node:path";
import { normalizeSpecifier } from "@dsmith/core";
import { isDir, listFiles } from "./fs-utils.js";

export interface DsDetection {
  kind: "npm" | "local" | "none";
  /** npm DS: 대표 패키지. 아이콘·x-*·styled-engine·utils·system이 아닌 첫 매칭 패키지(모두 해당하면 첫 번째) */
  packageName?: string;
  /** npm DS: DS로 판정되는 모든 의존성(import 집계에 쓴다) */
  packageNames?: string[];
  dir?: string;
  tokenFiles: string[];
}

const NPM_DS_PREFIXES = ["@radix-ui/", "@mantine/", "@chakra-ui/", "@mui/"];
/** 완성된 DS가 아니라 로컬 DS 아래에 깔리는 프리미티브 라이브러리(shadcn 패턴). */
const PRIMITIVE_PREFIXES = ["@radix-ui/", "@headlessui/"];
/** 대표 패키지로 고르지 않는 보조 패키지(아이콘, @mui/x-*, styled-engine, utils, system). */
const SECONDARY_PACKAGE = /icons|\/x-|styled-engine|utils|system/;
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

/** 의존성 이름 목록에서 DS로 보이는 패키지를 선언 순서대로 모두 찾는다. */
export function findNpmDsPackages(deps: string[]): string[] {
  return deps.filter(isNpmDs);
}

function isPrimitive(name: string): boolean {
  return PRIMITIVE_PREFIXES.some((p) => name.startsWith(p));
}

export async function detectDs(root: string, deps: string[], exclude: string[] = []): Promise<DsDetection> {
  const tokenFiles = await listFiles(root, [TOKEN_FILES], exclude);

  const packageNames = findNpmDsPackages(deps);
  let localDir: string | undefined;
  for (const dir of LOCAL_DS_DIRS) {
    if (await isDir(path.join(root, dir))) {
      localDir = dir;
      break;
    }
  }

  // 프리미티브(@radix-ui, @headlessui)만 있고 로컬 DS 디렉터리가 있으면 로컬 디렉터리가 DS다.
  const onlyPrimitives = packageNames.every(isPrimitive);
  const representative = packageNames.find((n) => !SECONDARY_PACKAGE.test(n)) ?? packageNames[0];
  if (representative !== undefined && !(onlyPrimitives && localDir !== undefined)) {
    return { kind: "npm", packageName: representative, packageNames, tokenFiles };
  }
  if (localDir !== undefined) return { kind: "local", dir: localDir, tokenFiles };
  return { kind: "none", tokenFiles };
}

/**
 * import 지정자(또는 ComponentUsage.module)가 감지된 DS(npm 패키지 또는 로컬 디렉터리)를 가리키는지.
 * npm은 서브패스(`@mui/material/Button`)도 받으므로 원본 specifier와 서브패스를 뗀 module 모두에 쓸 수 있다.
 */
export function isDsSpecifier(spec: string, ds: DsDetection): boolean {
  if (ds.kind === "npm") {
    const names = ds.packageNames ?? (ds.packageName !== undefined ? [ds.packageName] : []);
    return names.some((n) => spec === n || spec.startsWith(`${n}/`));
  }
  if (ds.kind === "local" && ds.dir !== undefined) {
    const dir = normalizeSpecifier(ds.dir);
    const s = normalizeSpecifier(spec);
    return s === dir || s.startsWith(`${dir}/`);
  }
  return false;
}
