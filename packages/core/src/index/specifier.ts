/** `./`, `../`, `@/`, `~/`, 선행 `/`, 선행 `src/`를 벗겨 별칭·상대경로 차이를 무시한다. */
export function normalizeSpecifier(spec: string): string {
  return spec.replace(/^(?:\.{1,2}\/)+/, "").replace(/^[@~]?\//, "").replace(/^src\//, "");
}
