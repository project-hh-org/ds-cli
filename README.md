# dsmith

도구 이름: dsmith (DS + smith — 디자인 시스템을 만들고 다듬는 도구). npm: `dsmith`, 스코프 `@dsmith-dev/*`.

운영 중인 코드베이스를 대상으로 디자인시스템(DS)을 진단 → 생성 → 정리 → 운영 → AI 연동까지 끌고 가는 CLI.

```
detect    # 레포를 읽어 스타일링 방식·DS 유무·시작 상태 판별 → .dsmith/detect.json
audit     # 하드코딩 값 분포, 중복 컴포넌트, 토큰 후보 → .dsmith/reports/audit-<날짜>.md
```

> **MVP 상태:** 구현된 커맨드는 `detect`와 `audit`뿐이다. `init`(DS 초안 생성), `migrate`(토큰 치환 codemod), `guard`(ESLint 규칙·CI 드리프트 검사), `ai`(MCP 서버·AGENTS.md·슬래시 명령), `usage`(사용량 대시보드)는 계획 단계다 — [설계 스펙](docs/superpowers/specs/2026-10-31-ds-cli-design.md) 참고.

아직 npm에 배포하지 않았으므로 빌드한 뒤 직접 실행한다. 배포 예정: `npx dsmith audit` ([MVP 계획](docs/superpowers/plans/2026-10-31-ds-cli-mvp.md) Goal).

```
pnpm install && pnpm -r build
node packages/cli/dist/bin.js detect --root <repo>
node packages/cli/dist/bin.js audit --root <repo>
```

### 감지 결과 고치기 (`overrides`)

감지가 틀렸으면 `<repo>/.dsmith/detect.json`에 `overrides`를 추가한다. 다시 감지해도 보존되고 새 결과 위에 적용된다(`state`, `activeExtractors`, `ds`, `exclude`).

```json
{
  "overrides": { "state": 2, "exclude": ["legacy/**"] }
}
```

### 분석 제외 (`--exclude`, `overrides.exclude`)

기본 제외: `node_modules`, `dist`, `.next`, `build`, `coverage`, `.dsmith`, 압축 스타일시트(`*.min.css`·`*.min.scss`), `vendor/`. `public/`은 손으로 쓴 CSS를 두는 앱이 있어 기본 제외가 아니다. 더 뺄 경로는 `detect`·`audit`의 `--exclude <glob...>`(여러 번 가능, 이번 실행만)나 `overrides.exclude`(저장)로 주며, 둘 다 기본 제외에 더해진다(대체하지 않음).

```
node packages/cli/dist/bin.js audit --root <repo> --exclude "public/**" "legacy/**"
```

## 지원하는 스타일링 방식

`detect`가 레포에서 감지한 방식 중 이름이 같은 Extractor만 `activeExtractors`로 켜지고, `audit`은 켜진 Extractor로만 스타일 값을 추출한다. 감지된 방식과 겹치는 Extractor가 하나도 없으면 `inline-style`이 대신 켜진다(`fallback`). 레지스트리는 `packages/cli/src/registry.ts`에 있다.

방식은 두 경로로 감지된다: 아래 표의 내장 감지, 그리고 Extractor 메타가 선언한 `signals`(의존성·파일 glob·코드 정규식 중 하나라도 맞으면). 표에 없는 Extractor도 `signals`와 레지스트리 등록이 둘 다 있으면 켜진다 — 신호만 있고 레지스트리에 없으면 켜지지 않는다. 표의 7개 이름은 이번 판에서 내장 감지가 판정한다(내장 Extractor도 `signals`를 선언해 두었지만 아직 쓰지 않는다).

`JS_FILES` = `**/*.{tsx,jsx,ts,js,mjs,cjs}`

| 방식 | Extractor | 파일 | 추출 대상 | 비고 |
| --- | --- | --- | --- | --- |
| Tailwind | `tailwind` | `JS_FILES` | `className` 문자열의 유틸리티 클래스 | 감지: `tailwindcss` 의존성, `tailwind.config.*`, CSS의 `@import "tailwindcss"`·`@tailwind`. 기본 테마 값은 `tailwind-default`, 커스텀 테마 키·`var(--…)`는 token, `[…]` arbitrary 값은 하드코딩 |
| inline style | `inline-style` | `JS_FILES` | JSX `style={{ … }}` 객체 | 감지: 소스의 `style={{`. 감지된 방식에 맞는 Extractor가 없을 때의 폴백 |
| CSS/SCSS 파일 | `css` | `**/*.{css,scss}` | 선언 블록의 속성 값 | 감지: `.module.`이 아닌 `.css`·`.scss` 파일. 소스를 TSX로 파싱하지 않는다(`parses: "none"`) |
| styled-components | `styled` | `JS_FILES` | `styled.x`·`styled(X)`·`css`·`createGlobalStyle`의 태그 템플릿과 객체 인자 | 감지: `styled-components` 의존성. `${…}` 보간은 동적 값으로 센다 |
| Emotion | `emotion` | `JS_FILES` | `css` 태그(`@emotion/react`·`@emotion/css`), `@emotion/styled`, JSX `css` prop(객체·중첩 선택자 포함) | 감지: `@emotion/react`·`@emotion/styled`·`@emotion/css` 중 하나의 의존성. styled-components만 import한 파일의 `css` prop은 보지 않는다 |
| MUI sx | `mui-sx` | `JS_FILES` | JSX `sx={{ … }}` 객체(반응형 값 객체는 펼쳐서) | 감지: `@mui/material`·`@mui/joy` 의존성 + 소스의 `sx={{`. 숫자 간격·`borderRadius`·팔레트 경로(`"primary.main"`)는 테마 token. `overrides.activeExtractors`에 예전 이름 `sx`를 쓰면 `mui-sx`로 바꿔 적용한다 |
| CSS Modules | — | — | 감지만 (`detect`가 `css-modules` 신호로 보고, 추출기 없음) | `*.module.{css,scss}` 파일. `audit` 리포트에 "감지됐지만 분석하지 않은 방식"으로 나온다 |

한계:

- MUI `styled()`(`@mui/material/styles`·`@mui/system`에서 import)는 아직 어느 Extractor도 추출하지 않는다. `styled`·`emotion`은 각자 패키지(`styled-components`, `@emotion/styled`)에서 import한 `styled`만 맡는다.
- 객체 리터럴이 아닌 스타일 참조(`style={styles.box}`, `sx={classes.root}`, `css={panel}`, `style={getStyle()}`)는 값을 알 수 없어 `dynamic` 1건(`property: other`)으로 센다. 리포트의 "동적 값"에 들어가고 점수 분모에는 들어가지 않는다.

## 구조

- `packages/core` — 공통 모델(`StyleUsage`·`ComponentUsage`), 색·길이 정규화, TSX·CSS 선언 파서, 인덱서(`indexRepo`, `DEFAULT_EXCLUDE`), 색·간격 클러스터링, 토큰 매처
- `packages/extractor-api` — Extractor 계약(`ExtractorMeta`·`signals`, `JS_FILES`)과 `runConformance`
- `packages/detect` — 레포 감지(스타일링 방식·DS·프레임워크·Storybook·lint)와 시작 상태 판정, `.dsmith/detect.json`
- `packages/extractor-tailwind` — Tailwind `className` 유틸리티 클래스
- `packages/extractor-inline-style` — JSX `style={{ … }}`
- `packages/extractor-css` — `.css`·`.scss` 파일 선언
- `packages/extractor-styled` — styled-components 태그 템플릿·객체 인자(emotion과 공유하는 CSS-in-JS 파서 포함)
- `packages/extractor-emotion` — Emotion `css` 태그·`@emotion/styled`·`css` prop
- `packages/extractor-mui-sx` — MUI `sx` prop
- `packages/cli` — `dsmith` 바이너리(`detect`·`audit`), Extractor 레지스트리, 마크다운 리포트
- `fixtures/` — e2e용 최소 레포
- `examples/legacy-demo` — 데모 대상 가상 어드민 앱

## 개발

```
pnpm install
pnpm -r build   # 테스트가 빌드된 dist를 import하므로 test 전에 필요
pnpm test
pnpm typecheck

# fixture로 audit 실행 (결과는 fixtures/<name>/.dsmith/ 에 생성, git 무시됨)
node packages/cli/dist/bin.js audit --root fixtures/tailwind-app
```

### fixtures

`packages/cli/test/e2e.test.ts`가 각 fixture에 `audit`을 돌려 수치와 리포트 스냅샷을 검사한다. 의존성은 `package.json`에 선언만 하고 설치하지 않는다.

- `tailwind-app` — Tailwind만. 근접한 파랑 두 개가 한 색 클러스터로 합쳐지고, `13px`이 스케일 밖 간격으로 잡힌다.
- `inline-app` — inline style만. 동적 값 1건, `background` 축약형의 색도 색 클러스터에 들어간다.
- `mixed-app` — Tailwind + inline style. 한 파일에서 두 Extractor의 usage가 모두 인덱스에 남는다.
- `with-ds-app` — `@radix-ui` + 로컬 `components/ui`. 로컬 DS로 판정되고, `Button` 중복과 DS import 비율을 보고한다.
- `styled-app` — styled-components만. 템플릿 리터럴의 근접한 파랑 두 개가 한 클러스터로 합쳐지고, 파일마다 따로 정의한 `Header`가 지역 재정의로 보고된다(중복 아님).
- `emotion-app` — Emotion만(`css` 태그, `@emotion/styled`, `css` prop 객체). 중첩 `"&:hover"` 안의 색까지 하드코딩 색 2종으로 센다.
- `mui-app` — MUI `sx`. `@mui/material`이 대표 DS이고, `@mui/material`과 `@mui/material/Button`의 `Button`은 중복이 아니다. 긴 이름 간격 키(`paddingTop: 1`)도 테마 token으로 센다.

데모 대상 `examples/legacy-demo`(Tailwind + inline style + `globals.css`)도 같은 e2e에서 점수 52, `Button`·`Badge` 중복, 리포트 스냅샷으로 고정한다.

## Extractor 추가하기

1. `@dsmith-dev/extractor-api`의 `Extractor`를 구현한다 — 메타 `ExtractorMeta`(`name`: 소문자 kebab-case, detect 방식 이름이 된다 / `files`: 읽을 glob, 소스를 읽으면 `JS_FILES` / `parses`: `"tsx"` 또는 `"none"` / `signals`: detect가 이 방식을 감지할 근거 — `dependencies`(package.json 패키지 이름), `files`(첫 매칭 파일이 근거인 glob), `code`(JS/TS·CSS 소스 내용에 대한 정규식 소스) 중 하나 이상, 하나라도 맞으면 감지)와 `appliesTo`·`extract`·`write`. `signals`가 없으면 detect가 감지하지 못해 켜지지 않는다.
2. 패키지 테스트에서 `runConformance(name, make, cases)`로 계약 검사(메타·`signals` 모양 포함)를 돌리고 `failed`가 비었는지 확인한다.
3. 패키지 구성은 `packages/extractor-css`를 따른다(`package.json`의 `exports`·`scripts`, `tsconfig.json`의 `references`).
4. `packages/cli/src/registry.ts`에 `이름: () => extractor` 한 줄을 더한다(`packages/cli/package.json` 의존성과 `tsconfig.json` 참조도 함께). `metas()`가 메타(`signals` 포함)를 detect에 넘기고, `signals`가 맞은 방식 중 레지스트리에 있는 것만 `activeExtractors`로 켜진다. core·detect 소스는 고치지 않는다.
5. `fixtures/<name>-app`을 만들고 `packages/cli/test/e2e.test.ts`에 `describe` 블록과 리포트 스냅샷을 더한다.
