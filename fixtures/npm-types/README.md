# fixtures/npm-types

`@mui/material` 공개 타입 선언 발췌. dsmith 카탈로그 빌더(`packages/catalog`)의 npm `.d.ts` 추출 테스트용이며, 테스트 헬퍼가 임시 디렉터리의 `node_modules/@mui/material`로 복사한다.

- `mui-material-6/` — `@mui/material@6.5.0` (npm pack, 2026-11-01). `package.json`은 name·version·license·types만 남김. `index.d.ts`는 `Button`·`TextField`·`Select`의 re-export 줄만, 각 `*/index.d.ts`는 `*Classes` 두 줄을 제거. `Button/Button.d.ts`·`TextField/TextField.d.ts`·`Select/Select.d.ts`는 원문 그대로.
- `mui-material-9/` — `@mui/material@9.5.0`의 같은 파일(`.d.mts`). `package.json`은 원본 `exports["."]` 조건 맵(`import`/`require`/`default` 각각 `types`)을 유지한다. 원본은 `exports["./*"]` 와일드카드가 아니라 컴포넌트별 `./Button` 같은 항목을 두며 여기서는 생략했다. `types: "./index.d.ts"`는 그대로 두되 해당 파일은 없다(exports가 우선해야 통과).
- `TextField`는 제네릭 함수 + 조건부 타입(`TextFieldProps<Variant>`), `Select`는 함수 타입 & 객체 교차 + 제네릭 유니온 별칭이라 실제 배치의 어려운 경우를 고정한다.

라이선스: MIT, Copyright (c) Call-Em-All (각 디렉터리의 LICENSE).
