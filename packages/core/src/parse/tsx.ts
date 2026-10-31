import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import type { File } from "@babel/types";

// @types/babel__traverse는 CJS 선언이라 NodeNext ESM의 default import 타입이 모듈 네임스페이스({ default })다.
type TraverseFn = (typeof traverseModule)["default"];

// 런타임에서도 @babel/traverse는 CJS라 default import가 `{ default: fn }`으로 올 수 있어 함수를 꺼내 정규화한다.
export const traverse: TraverseFn =
  (traverseModule as unknown as { default?: TraverseFn }).default ??
  (traverseModule as unknown as TraverseFn);

export function parseTsx(code: string, file: string): File {
  return parse(code, {
    sourceType: "module",
    plugins: ["jsx", "typescript"],
    errorRecovery: true,
    sourceFilename: file,
  });
}
