# fixtures/npm-types

`@mui/material` 공개 타입 선언 발췌. dsmith 카탈로그 빌더(`packages/catalog`)의 npm `.d.ts` 추출 테스트용이며, 테스트 헬퍼가 임시 디렉터리의 `node_modules/@mui/material`로 복사한다.

- `mui-material-6/` — `@mui/material@6.5.0` (npm pack, 2026-11-01). `package.json`은 name·version·license·types만 남김. `index.d.ts`는 `Button` 두 줄만, `Button/index.d.ts`는 `buttonClasses` 두 줄을 제거. `Button/Button.d.ts`는 원문 그대로.
- `mui-material-9/` — `@mui/material@9.5.0`의 같은 파일(`.d.mts`). `package.json`은 원본 `exports["."]`·`exports["./*"]` 조건 맵을 유지하고 `types: "./index.d.ts"`는 그대로 두되 해당 파일은 없다(exports가 우선해야 통과).

라이선스: MIT, Copyright (c) Call-Em-All (각 디렉터리의 LICENSE).
