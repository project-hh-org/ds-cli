import { posix } from "node:path";
import { resolveWithPaths, type TsPaths } from "@dsmith-dev/core";

/** 패키지 모양: 범위 패키지(`@scope/name`)거나 `/`가 없는 이름. 경로 module 키는 대개 `src/…`처럼 `/`를 가진다 */
function looksLikePackage(module: string): boolean {
  return (module.startsWith("@") && !module.startsWith("@/")) || !module.includes("/");
}

/** `"./src/*"` 같은 paths 대상에서 `*` 앞 디렉터리를 root 상대 POSIX로. 와일드카드가 끝에 있는 대상만 */
function aliasDir(tsPaths: TsPaths, target: string): string | null {
  if (!target.endsWith("*") || target.indexOf("*") !== target.length - 1) return null;
  const dir = posix.join(tsPaths.baseUrl === "" ? "." : tsPaths.baseUrl, target.slice(0, -1));
  const trimmed = dir.replace(/\/+$/, "");
  return trimmed === "" ? "." : trimmed;
}

/**
 * importer 파일에서 module 키를 가리킬 import specifier(순수).
 * - 패키지 → 그대로.
 * - 경로 → tsconfig paths 별칭 중 대상 디렉터리가 module을 덮는 첫 것(`@/*` → `src/*`면 "@/components/ui/button").
 *   정확 일치 키(와일드카드 없음)도 대상이 module 자신이면 쓴다. 만든 specifier가 `resolveWithPaths`로 다시 같은 module로 풀릴 때만 채택한다.
 * - 별칭이 없으면 importer 디렉터리 기준 상대 경로(`./`·`../` 접두, 확장자 없음).
 * `isPath`를 주면 module이 패키지인지 경로인지 추측하지 않고 그대로 따른다.
 */
export function specifierForModule(importer: string, module: string, tsPaths: TsPaths | null, isPath?: boolean): string {
  const path = isPath ?? !looksLikePackage(module);
  if (!path) return module;

  if (tsPaths !== null) {
    for (const [key, targets] of Object.entries(tsPaths.paths)) {
      const target = targets[0];
      if (target === undefined || key === "*") continue;
      let spec: string | null = null;
      if (key.includes("*")) {
        const dir = aliasDir(tsPaths, target);
        if (dir === null) continue;
        const rest = dir === "." ? module : module.startsWith(`${dir}/`) ? module.slice(dir.length + 1) : null;
        if (rest === null || rest === "") continue;
        spec = key.replace("*", rest);
      } else if (!target.includes("*")) {
        const resolved = posix.join(tsPaths.baseUrl === "" ? "." : tsPaths.baseUrl, target).replace(/\.[cm]?[jt]sx?$/, "").replace(/\/index$/, "");
        if (resolved === module) spec = key;
      }
      if (spec !== null && resolveWithPaths(spec, importer, tsPaths) === module) return spec;
    }
  }

  const rel = posix.relative(posix.dirname(importer), module);
  return rel.startsWith(".") ? rel : `./${rel}`;
}
