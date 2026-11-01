import { parse, type ParserPlugin } from "@babel/parser";
import traverseModule from "@babel/traverse";
import type { File } from "@babel/types";

// @types/babel__traverse는 CJS 선언이라 NodeNext ESM의 default import 타입이 모듈 네임스페이스({ default })다.
type TraverseFn = (typeof traverseModule)["default"];

// 런타임에서도 @babel/traverse는 CJS라 default import가 `{ default: fn }`으로 올 수 있어 함수를 꺼내 정규화한다.
export const traverse: TraverseFn =
  (traverseModule as unknown as { default?: TraverseFn }).default ??
  (traverseModule as unknown as TraverseFn);

const DTS_FILE = /\.d\.[cm]?ts$/;

function pluginsFor(file: string): ParserPlugin[] {
  // 선언 파일(.d.ts/.d.mts/.d.cts): ambient 문맥 규칙(dts), jsx 없음. 부록 B.3 (babeljs.io/docs/babel-parser, 2026-11-01 확인)
  if (DTS_FILE.test(file)) return [["typescript", { dts: true }]];
  // .ts/.mts/.cts에서는 jsx 플러그인이 `<T>expr` 단언과 제네릭 화살표 함수를 깨뜨리므로 끈다.
  return /\.[cm]?ts$/.test(file) ? ["typescript"] : ["jsx", "typescript"];
}

export function parseTsx(code: string, file: string): File {
  return parse(code, {
    sourceType: "module",
    plugins: pluginsFor(file),
    errorRecovery: true,
    sourceFilename: file,
  });
}
