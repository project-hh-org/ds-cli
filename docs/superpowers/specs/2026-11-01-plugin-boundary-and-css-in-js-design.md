# dsmith Plan 2 — 플러그인 경계 보강 + CSS-in-JS·MUI sx Extractor

작성일: 2026-11-01
상태: 승인 (다희 위임 — "직접 최고의 판단")
선행: `2026-10-31-ds-cli-design.md` (전체 설계), MVP 구현 완료 (`main` 22457ba)

## 1. 왜 지금 이것인가

MVP 최종 리뷰와 실제 운영 어드민(1,140 파일, Next.js pages + MUI + Emotion + styled-components) 적용에서 드러난 두 가지:

1. **"새 스타일링 지원 = 파일 하나"가 아직 거짓이다.** 세 번째 Extractor를 붙이려면 인덱서 글롭(`**/*.{tsx,jsx,ts,js}`), 인덱서의 무조건 `parseTsx`, detect의 `IMPLEMENTED_EXTRACTORS` 하드코딩까지 세 군데를 고쳐야 한다.
2. **실제 레포의 95%가 분석 불가였다.** styled-components·Emotion·MUI `sx`는 "감지됐지만 분석하지 않음" 경고만 냈고, 건강 점수는 inline style 5,480건만으로 계산됐다. 이 상태의 숫자는 면접에서 쓸 수 없다.

이 계획은 1을 고치고, 그 구조 위에서 2를 해결한다. 끝나면 같은 레포를 다시 돌려 before/after를 뽑는다.

## 2. 범위

포함:
- Extractor 계약 v2 (파일 글롭 선언, 담당 스타일링 방식 선언, 선택적 `prepare`)
- 인덱서: 글롭 합집합, 컴포넌트 사용량은 JS/TS 파일에서만, 비-JS 파일은 파싱 시도 안 함
- detect: 사용 가능한 Extractor 목록을 호출자(cli)로부터 받음 → `IMPLEMENTED_EXTRACTORS` 삭제; 스타일링 방식에 `mui-sx`(MUI) 추가
- core `parse/css-text.ts`: CSS 선언 텍스트(`prop: value;`) 파서 — emotion/styled 템플릿 리터럴과 `.css` 파일이 공유
- 새 Extractor 4종: `extractor-css`(`.css/.scss` 파일), `extractor-styled`(styled-components), `extractor-emotion`(`css` prop·`css`` ` 태그·`@emotion/styled`), `extractor-mui-sx`(`sx` prop + MUI 테마 키)
- 중복 판정 보정: 패키지 서브패스 정규화, tsconfig `paths` 별칭 해석, DS 대표 패키지 우선순위
- fixtures 3종 추가(styled-app, emotion-app, mui-app) + e2e, 실제 레포 재측정(비공개)

제외(다음 계획): `init`, `migrate`, `guard`, `ai`, 이름 다른 중복(유사도), 색 이름 명도 보정, alpha, `.gitignore` 존중.

## 3. Extractor 계약 v2

```ts
export interface ExtractorMeta {
  name: string;                    // "tailwind" | "inline-style" | "css" | "styled" | "emotion" | "mui-sx" — detect 방식 이름과 동일
  files: string[];                 // 이 Extractor가 읽는 글롭. 예: JS_FILES = ["**/*.{tsx,jsx,ts,js,mjs,cjs}"], ["**/*.{css,scss}"]
  parses: "tsx" | "none";          // "tsx"면 인덱서가 파싱 실패를 skipped로 기록하는 대상 파일. css는 "none"
  signals?: {                      // detect 감지 근거(OR). fix wave B2에서 추가 — §5 참고
    dependencies?: string[];       // package.json dependencies·devDependencies 이름
    files?: string[];              // 첫 매칭 파일이 근거인 글롭(! 부정 포함)
    code?: string;                 // JS/TS·CSS 소스 내용에 대한 정규식 소스
  };
}
export interface Extractor extends ExtractorMeta {
  appliesTo(ctx: ExtractContext): boolean;
  extract(ctx: ExtractContext): StyleUsage[];
  write(usage: StyleUsage, tokenRef: string): WritePatch | null;
  /** 선택. 레포 단위 준비(예: MUI 테마 파일 읽기). indexRepo가 파일 순회 전에 한 번 호출 */
  prepare?(root: string): Promise<void> | void;
}
```

- `StyleUsage.extractor`는 그대로 `name`.
- `StyleSource`에 `"theme"`를 추가하지 않는다. MUI `color: "primary.main"`, `p: 2`처럼 테마 스케일을 가리키는 값은 `source: "token"`이다(이미 이름 있는 값). 이유: 건강 점수의 분모 정의(`hardcoded + tailwind-default + token`)를 바꾸지 않기 위해.
- conformance 러너는 `files`가 비어 있지 않고 `name`이 소문자-하이픈인지도 검사한다.

## 4. 인덱서 변경

- 입력 글롭 = 모든 Extractor의 `files` 합집합(중복 제거) ∪ 컴포넌트 사용량용 `JS_FILES`(`**/*.{tsx,jsx,ts,js,mjs,cjs}`); 기본 제외 목록은 그대로(이후 fix wave B2에서 `*.min.css`·`*.min.scss`·`vendor/` 추가, `--exclude`·`overrides.exclude`로 확장).
- 파일별: 해당 파일을 `files`로 매칭하는 Extractor 중 `appliesTo`인 것만 호출(`picomatch`로 글롭 매칭).
- `parseTsx` + `extractComponentUsage`는 JS/TS 확장자에서만. `.css` 파일에서 파싱 오류가 "parse" skip으로 잡히는 일이 없어야 한다.
- 파일 하나 안에서 Extractor 하나가 던지면 그 파일 전체 skip(기존 all-or-nothing 유지), reason에 Extractor 이름 포함: `parse(styled): …`.
- `Index.extractors`는 실행된 이름 목록(기존과 동일).

## 5. detect 변경

- `detect(root, index?, opts?: { available?: ExtractorMeta[] })` — cli가 레지스트리의 메타를 넘긴다. 없으면(라이브러리로 쓸 때) `activeExtractors`는 빈 배열이 아니라 `methods` 이름 그대로를 반환하고 `provisional`과 별개로 `extractorsResolved: false`를 표시한다.
- `activeExtractors` = `methods`에 있는 이름 ∩ `available.map(m => m.name)`. 비면 `available` 중 `inline-style`이 있을 때만 폴백.
- `methods` = 내장 감지 방식 ∪ `available` 메타의 `signals`가 맞은 방식(이름 중복 시 내장 우선; 내장 방식 이름의 `signals`는 아직 평가하지 않음 — 내장 블록을 `signals`로 옮기는 것은 다음 계획). 그래서 서드파티 Extractor는 `signals` + 레지스트리 등록만으로 켜진다.
- 스타일링 방식 추가: `mui-sx` — 근거 `@mui/material` 또는 `@mui/joy` 의존성 + 코드에 `sx={{`; `share`는 해당 Extractor 사용량.
- `css` 방식: 근거 `.css/.scss` 파일 존재(모듈 아닌 것). `css-modules`는 기존대로 감지만(Extractor는 이번 범위 밖 — `.module.css`의 클래스는 JSX에서 `styles.x`로 쓰여 사용 위치 매핑이 별도 문제).
- DS 대표 패키지: `packageNames` 중 `icons`/`x-`/`styled-engine`/`utils`/`system`이 이름에 없는 것을 `packageName`으로 우선(`@mui/material` > `@mui/icons-material`). 전부 해당하면 첫 번째.

## 6. core 추가

### 6.1 `parse/css-text.ts`
```ts
export interface CssDecl { property: string; value: string; start: number; end: number; dynamic: boolean }
export function parseCssDeclarations(text: string, offset?: number): CssDecl[];
```
- `prop: value;` 반복을 파싱. 중괄호 블록(`&:hover { … }`, 미디어쿼리) 안도 재귀. 주석 제거. `${…}` 플레이스홀더(호출자가 템플릿 리터럴 표현식을 `\u0000N\u0000` 같은 토큰으로 치환해 넘김)가 값에 있으면 `dynamic: true`.
- `start/end`는 **값** 구간의 텍스트 내 오프셋(+offset) — `write()`가 값만 치환.
- 속성명은 kebab 그대로; `cssPropertyToStyleProperty`는 inline-style 패키지에서 core로 이동(`model/css-property.ts`)해 모든 Extractor가 공유. `background`/`border`/`outline` 축약의 색 승격 규칙도 함께 이동. `border: 1px solid #000` 같은 복합값은 색 토큰을 분리해 `border-color` usage 1건을 만든다(값 치환 범위는 그 색 토큰만).

### 6.2 `index/specifier.ts` 확장
- `normalizePackageSpecifier("@mui/material/Button")` → `"@mui/material"` (스코프 패키지는 두 세그먼트, 아니면 한 세그먼트). `componentUsage.importedFrom`에는 **원본 유지**하고, 새 필드 `module: string`에 정규화 값을 둔다. 중복 판정과 `dsImportShare`는 `module` 기준.
- tsconfig `paths` 해석: `readTsconfigPaths(root)` → `{ baseUrl, paths }`; `resolveSource`가 `@/x`뿐 아니라 임의 별칭(`~`, `src/*`, `components/*`)을 `paths`로 해석. `tsconfig.json`의 `extends`는 한 단계만 따라간다. `jsconfig.json`도 같은 규칙.

### 6.3 중복 판정
- 그룹 키 = `name` + `module`. 같은 `module`이면 중복 아님(`@mui/material` vs `@mui/material/Button`).
- `importedFrom === null`(같은 파일에서 정의한 로컬 컴포넌트)은 중복 후보에서 제외하고 `localDefinitions[name]`로 따로 센다 — styled-components 레포에서 `Header`가 40개 파일에 각각 정의되는 패턴은 "중복"이 아니라 "지역 재정의"로 리포트에 별도 표기.

## 7. 새 Extractor

| 패키지 | files | 추출 대상 | write |
| --- | --- | --- | --- |
| `extractor-css` | `**/*.{css,scss}` (module 제외는 `appliesTo`에서 `.module.` 필터) | 모든 선언. `var(--x)` → token. `$var`(scss) → token | 값 치환 |
| `extractor-styled` | `JS_FILES` | `styled.tag\`…\``, `styled(Comp)\`…\``, `styled.tag.attrs(..)\`…\``, `css\`…\``(styled-components의 css), 객체 문법 `styled.div({...})` | 템플릿: 값 구간 치환 / 객체: 리터럴 치환 |
| `extractor-emotion` | 동일 | `css` prop 객체·`css\`…\`` 태그(@emotion/react), `@emotion/styled`의 `styled.*` — styled와 파서 공유. import 출처로 두 패키지를 구분 | 동일 |
| `extractor-mui-sx` | 동일 | `sx={{…}}`, `sx={[…]}`의 객체 요소, `sx={cond ? {...} : {...}}` 양쪽. 테마 스케일 해석: `p/m/px/py/pt/pr/pb/pl/mx/my/mt/mr/mb/ml/gap: <number>` → px = n×8 `source: "token"`(테마 스케일 참조이므로); `color/bgcolor/borderColor: "primary.main"` 등 팔레트 경로 → token; 문자열 리터럴 색·길이 → hardcoded | 리터럴 치환 |

공통 규칙:
- 템플릿 리터럴 안의 `${expr}`가 선언 값에 걸리면 그 선언은 `dynamic` 1건. 선언 밖(셀렉터 자리)의 표현식은 무시.
- styled/emotion은 **어느 패키지에서 import했는지**로 분기: `styled-components` → `styled`, `@emotion/styled`·`@emotion/react` → `emotion`. 둘 다 없는데 `styled.div` 호출이 있으면 `styled`로 귀속.
- 네 Extractor 모두 conformance 케이스 + 각자 패키지 테스트.

## 8. cli 변경

- 레지스트리에 4종 추가; `detect(root, index, { available: Object.values(registry).map(f => f().meta) })`.
- 리포트: "감지됐지만 분석하지 않은 방식"은 그대로(이제 css-modules만 남음), `지역 재정의 컴포넌트` 섹션 추가(`localDefinitions` 상위 20).
- `audit --json`의 `AuditResult`에 `localDefinitions: { name, files: number }[]` 추가.

## 9. 증명

- fixtures: `styled-app`(styled-components, 브랜드색 변종 템플릿 리터럴, `${}` 동적 1건), `emotion-app`(css prop + @emotion/styled), `mui-app`(sx 숫자 스케일 + 팔레트 경로 + 하드코딩 hex 혼용, `@mui/material` + `@mui/icons-material` 서브패스 import), 각 e2e.
- 플러그인 경계 테스트: 테스트 안에서 가짜 Extractor(`files: ["**/*.txt"]`, `parses: "none"`, `signals: { files: ["**/*.txt"] }`)를 레지스트리에 추가하면 detect가 `signals`로 `txt` 방식을 감지해 `activeExtractors`에 넣고, 인덱서가 `.txt`를 읽으며, 컴포넌트 파싱은 시도하지 않는지 — **core/detect/cli 소스 수정 없이** 통과해야 한다(`core/test/indexer.test.ts`, `detect/test/detect.test.ts`, `cli/test/cli.test.ts` "플러그인 경계"). 인덱서 절반만 있던 것을 fix wave B2에서 detect 절반까지 채웠다.
- 실제 어드민 레포 재측정(비공개): 분석 커버리지(분석된 스타일 사용 / 전체 감지 방식), 하드코딩 비율, 중복 수 before/after를 `docs/decisions/`에 숫자만 기록.

## 10. 구현 순서

1. 계약 v2 + conformance 확장 + 기존 두 Extractor에 `files`/`parses` 추가
2. 인덱서 글롭 합집합·JS 전용 파싱 + 가짜 Extractor 경계 테스트
3. detect `available` 주입, `mui-sx`/`css` 방식, `packageName` 우선순위
4. core `css-text` 파서 + `css-property` 이동 + `extractor-css`
5. `extractor-styled` + `extractor-emotion`
6. `extractor-mui-sx`
7. 서브패스·tsconfig paths·지역 재정의 + 리포트 섹션
8. fixtures 3종 + e2e + README
9. 실제 레포 재측정 기록

## 11. 미결

- [ ] `css-modules` Extractor(클래스 → 사용 위치 매핑) — 다음 계획
- [ ] Tailwind v4 `@theme` 토큰 읽기 — DS 소스 어댑터 계획으로
