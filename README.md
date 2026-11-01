# dsmith

도구 이름: dsmith (DS + smith — 디자인 시스템을 만들고 다듬는 도구). npm: `dsmith`, 스코프 `@dsmith-dev/*`.

운영 중인 코드베이스를 대상으로 디자인시스템(DS)을 진단 → 생성 → 정리 → 운영 → AI 연동까지 끌고 가는 CLI.

```
detect    # 레포를 읽어 스타일링 방식·DS 유무·시작 상태 판별 → .dsmith/detect.json
audit     # 하드코딩 값 분포, 중복 컴포넌트, 토큰 후보 → .dsmith/reports/audit-<날짜>.md
install   # 쓰는 AI 도구를 감지해 슬래시 명령(/ds …)과 MCP 서버 등록을 레포에 내려씀 → .dsmith/install.json
mcp       # MCP 서버(stdio). AI 도구가 띄운다 — 직접 실행할 일은 없음
decide    # 중복·지역 재정의 컴포넌트의 결정 카드 보기(--list/--explain), 고른 결과 기록(--item/--choose) → .dsmith/decisions.json
init      # audit 결과로 DS 초안 생성: W3C 토큰 파일·CSS 변수·TS 상수, 컴포넌트 골격, 커버리지 → design-system/
ai        # DS에서 컴포넌트 카탈로그를 만들고 AGENTS.md의 DS 섹션을 갱신 → .dsmith/catalog.json
migrate   # 하드코딩 값을 토큰 참조로, 결정된 중복 컴포넌트를 DS 컴포넌트로 치환(기본은 계획만) → .dsmith/migrations/
guard     # 하드코딩이 다시 늘지 않게 ESLint 규칙·PR diff 검사 설정 → .dsmith/guard.json
```

> **MVP 상태:** 구현: `detect`·`audit`·`install`·`mcp`·`decide`·`init`·`ai`·`migrate`·`guard`. 계획: `usage`(사용량 대시보드) — [설계 스펙](docs/superpowers/specs/2026-10-31-ds-cli-design.md) 참고.

0.1.0 배포 전까지는 빌드한 뒤 직접 실행한다. 배포는 릴리스 PR(`chore: 버전 올림`)을 머지하면 GitHub Actions가 자동으로 하며, 절차는 [docs/release.md](docs/release.md)에 있다.

```
pnpm install && pnpm -r build
node packages/cli/dist/bin.js detect --root <repo>
node packages/cli/dist/bin.js audit --root <repo>
```

0.1.0 배포 후에는 설치 없이 실행할 수 있다.

```
npx dsmith audit        # 또는: pnpm dlx dsmith audit
```

## DS 초안 (init · ai)

`audit → decide → init → ai`. DS가 없는 레포(상태 0)는 `init`으로 초안을 만들고, DS가 있는 레포(상태 1·2)는 `ai`만으로 카탈로그를 만든다.

| 산출 | 위치 | 내용 |
| --- | --- | --- |
| 토큰 파일 | `design-system/tokens.{json,css,ts}` | `json`은 W3C Design Tokens 2025.10 형식, `css`는 `:root` CSS 변수, `ts`는 TS 상수. 셋의 토큰 수가 같다 |
| 컴포넌트 골격 | `design-system/components/<Name>.tsx` | 새 파일만. 결정한 항목(또는 `--all`의 추천안 상위 `--top`개)이 대상 |
| 컴포넌트 카탈로그 | `.dsmith/catalog.json` | 로컬 DS 디렉터리 / npm 패키지의 `.d.ts` / `init` 산출에서 읽은 컴포넌트·props(허용 값 포함)·폐기 표시·토큰 |
| AI 규칙 | `AGENTS.md`의 `<!-- dsmith:ds:start -->` … `<!-- dsmith:ds:end -->` | DS 위치, 자주 쓰는 컴포넌트, 폐기 예정, 토큰 파일, MCP 도구 안내. 그 밖의 줄은 건드리지 않는다 |

```
npx dsmith init --dry-run    # 쓸 파일과 diff, 토큰 수, 커버리지만 보기
npx dsmith init --all        # 결정 없이 추천안으로 스캐폴드(상위 --top개, 기본 10)
npx dsmith ai                # 카탈로그와 AGENTS.md DS 섹션
```

- 커버리지는 하드코딩 값 중 토큰으로 치환 가능한 비율로 `migrate` 후보 수와 같다. 요약은 이를 같은 값/정확(`migrate` 기본 대상)과 근사(`--close`로만)로 나눠 보인다. 쓴 `tokens.css`를 아무도 import하지 않으면 같은 안내를 낸다. 색·글꼴 크기 토큰은 이 초안이 하드코딩 값에서 직접 만들기 때문에 사실상 간격·모서리 커버리지를 반영한다.
- 쓰기 규칙: 토큰 파일은 사람이 고친 것을 `--force` 없이 덮어쓰지 않는다. 스캐폴드는 `--force`로도 덮어쓰지 않는다. `--dry-run`은 `.dsmith/`를 포함해 아무것도 쓰지 않는다. 두 번째 실행은 아무것도 바꾸지 않는다.
- npm 패키지 DS(예: `@mui/material`)는 `node_modules`가 설치돼 있어야 `.d.ts`를 읽는다. 설치가 없으면 `ai`가 그렇게 알린다.
- MCP 서버는 `.dsmith/catalog.json`이 있으면 그것을 먼저 읽는다: `get_component`가 `source: "catalog"`로 props·허용 값·폐기·사용 예를 답하고, `search_component`는 아직 쓰이지 않는 DS 컴포넌트도 찾고, `resolve_token`은 카탈로그 토큰을 `source: "catalog"`로 돌려준다. 카탈로그가 없으면 이전과 같이 사용처 인덱스에서 답한다.
- Claude Code는 `CLAUDE.md`가 있으면 `AGENTS.md`를 읽지 않는다. `CLAUDE.md`에 `@AGENTS.md` 한 줄을 추가한다(`ai`가 필요할 때 알려 준다).

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

## 적용·방어 (migrate · guard)

`init`·`ai` 뒤에 `migrate`로 기존 코드의 하드코딩을 토큰으로 옮기고, `guard`로 다시 늘지 않게 막는다. 순서는 `… → ai → migrate → guard`.

### migrate

```
npx dsmith migrate                                   # 계획만 보기 — 어떤 파일도 쓰지 않는다(.dsmith 포함)
npx dsmith migrate --apply --branch ds/migrate-tokens # 새 브랜치에 적용하고 커밋 1개
npx dsmith migrate --revert <id>                     # 기록으로 되돌리기
npx dsmith migrate --list                            # 마이그레이션 기록 목록
```

- 후보는 `init`의 커버리지와 같은 규칙으로 고른다. 후보 수 = 계획 + 건너뜀(사유별) + 범위 제한 + close 제외이고, 출력이 이 등식을 보여준다. 가까운 토큰이 없는 값(먼 값)과 동적 값은 후보가 아니라 "범위 밖"으로 따로 센다. 숫자는 사람용 출력, `--json`, `.dsmith/reports/migrate-<날짜>.md`가 같다.
- 기본은 값이 같은(identical) 매칭과 exact 매칭만 바꾼다. 근사(close, ±2px·색 ΔE 임계 안)는 건수만 알리고, `--close`를 줘야 포함한다. 렌더링되는 값이 바뀔 수 있어서다.
- 건너뛰는 것: 반투명 색, 값이 여러 개인 단축 속성, 음수·0, SCSS 변수, 토큰 참조를 만들 수 없는 값, UTF-8이 아닌 파일. 사유는 계획 출력과 `--json`의 `plan.skipped`에 나온다. 범위를 좁히려면 `--files <glob>`, `--category <color|spacing|radius|font-size>`, `--only <tokens|components>`.
- 결정(`decide`)한 중복 컴포넌트는 import를 DS 쪽으로 바꾼다. props 이름·값이 다르면 `decide --map <from>:<to>`(값까지 바뀌면 `prop=value:prop=value`)로 대응을 줘야 하고, 없거나 동적 값이면 그 사용은 보류한다. 지역 정의는 지우지 않고 주석만 단다.
- migrate가 쓰는 `var(--…)`는 `init`이 만든 `design-system/tokens.css`가 전역에 로드돼야 값을 갖는다. 아무도 import하지 않으면 계획·적용 출력과 리포트에 안내가 나오고(`plan.tokens.loaded`), `app/layout.tsx`·`src/main.tsx`·`globals.css` 같은 전역 엔트리에서 import하면 사라진다. 안내만 하고 적용은 막지 않는다. `init`도 같은 경우 같은 안내를 낸다.
- Tailwind: `init`이 프리셋(v3 `tailwind.preset.*`, v4 `@theme` CSS)을 함께 만든다. tailwind 설정에 연결돼 있으면 클래스명(`bg-ds-blue-400`)으로, 연결 안 됐으면 임의값(`bg-[color:var(--color-blue-400)]`)으로 바꾸고 그렇다고 알린다.
- 파일 단위로 재파싱·재추출 검증을 하고, 실패한 파일은 쓰지 않는다. 쓰기 직전 해시를 비교해 계획 뒤 바뀐 파일도 건너뛴다. audit 뒤 파일이 바뀌었으면 `plan.stale`로 알리고 audit를 다시 하라고 한다.
- `--branch`는 git 2.23 이상, git 작성자 정보(`user.name`·`user.email`), 커밋되지 않은 변경이 없고 `.gitignore`에 걸리지 않는 대상 파일, 아직 없는 브랜치 이름이 있어야 한다. 치환된 `var()`·프리셋이 가리킬 토큰 파일(`plan.tokens.files`)과 연결된 프리셋 파일이 커밋되지 않았거나 수정됐으면 쓰기 전에 오류로 막는다(먼저 커밋하거나 `--with-tokens`로 같은 커밋에 넣는다. `.dsmith/`는 늘 제외). 결과는 셋 중 하나다: 커밋됨 / 일부 파일 실패로 커밋 없이 남음(되돌리기 명령을 출력) / 적용된 것이 없어 브랜치를 버림. push하거나 PR을 열지 않는다.
- 종료 코드 1: 롤백된 파일·계획 뒤 바뀐 파일·쓰기 실패가 있거나, `--revert`에서 일부만 되돌렸을 때(적용 뒤 수정된 파일은 건너뜀).
- 알려진 한계: Tailwind v4에서 `tokens.css`의 `--color-*`·`--radius-*`·`--text-*`가 Tailwind 기본 테마 변수와 같은 이름이면 기본 유틸리티(`bg-blue-400`, `rounded-sm` 등)의 값이 바뀔 수 있다. 이 도구는 이를 다루지 않는다.

### guard

```
npx dsmith guard init --ci github            # 스냅샷·ESLint 설정·GitHub Actions 워크플로
npx dsmith guard --ci --base origin/main     # PR이 새로 들인 것만 검사
```

- `guard init`은 `.dsmith/guard.json`(토큰·DS 컴포넌트·정책 스냅샷)을 만들고 `eslint.config.*`에 `@dsmith-dev/eslint-plugin`의 `configs.recommended` 블록을 끼워 넣는다. `--ci github`면 `.github/workflows/dsmith-guard.yml`(권한 `contents: read`, `pull-requests: write`, `fetch-depth: 0`)도 쓴다. 사람이 고친 블록은 `--force` 없이 덮어쓰지 않는다. `.dsmith/guard.json`은 커밋해야 한다.
- ESLint 설정을 고치지 못하면 이유와 붙여 넣을 코드(`snippet`)를 알려 준다: `legacy`(eslintrc — flat config만 지원), `unsupported-shape`, `needs-ts-parser`(TS 파일이 있는데 설정에 TS 파서가 없음), `not-eslint`(biome·oxlint), `no-config`. 이 경우에도 `guard --ci`는 쓸 수 있다.
- ESLint 규칙(`dsmith/no-hardcoded-style`, `prefer-ds-component`, `no-deprecated-component`)은 JS/TS 파일만 검사한다. CSS·SCSS는 `guard --ci`가 검사한다. `.dsmith/guard.json`이 없거나 깨지면 규칙은 조용히 통과한다. `eslint --cache`를 쓰면 `guard.json`을 바꾼 뒤 첫 실행은 캐시 없이 돌린다(`packages/eslint-plugin/README.md`).
- `guard --ci --base <ref>`는 merge-base 대비 바뀐 파일에서 신규 하드코딩·DS 밖 컴포넌트·deprecated 컴포넌트만 센다. 이름이 바뀐 파일은 옛 경로와 비교하고, 하위 디렉터리 `--root`와 모노레포도 된다. 정책(허용 목록·`failOn`)은 PR이 아니라 merge-base의 `guard.json`에서 읽는다. 신규 하드코딩이나 deprecated가 정책 임계를 넘으면 종료 코드 1이다.
- `--comment`는 PR에 코멘트 하나를 마커로 찾아 갱신한다. 토큰이 없거나 포크 PR이라 403이 나도 경고만 하고 종료 코드는 그대로다. 토큰 파일이 `guard init` 뒤에 바뀌었으면 `staleSnapshot`에 파일 이름이, 기록되지 않은 새 토큰 파일이면 `+<파일>`로 나온다.

### 같은 규칙 엔진

`migrate`가 후보를 고르는 규칙, ESLint 플러그인이 보고하는 규칙, `guard --ci`가 세는 규칙, MCP `lint_snippet`의 답은 모두 `@dsmith-dev/core`의 같은 함수(`evaluateFile`·`bestReplacement`)에서 나온다. 그래서 migrate가 바꾼 것은 guard가 신규로 세지 않고, ESLint가 보고한 것은 guard가 같은 위치에서 같은 값으로 센다. `packages/cli/test/e2e-migrate-guard.test.ts`가 `examples/legacy-demo`에서 `init → migrate → guard`를 끝까지 돌려 이를 고정한다.

## 벤치마크

`benchmarks/`(비공개 워크스페이스, 배포 안 함)는 같은 UI 생성 프롬프트 12개를 같은 에이전트에 두 조건으로 돌리고, 만들어진 파일을 위 "같은 규칙 엔진"(`evaluateFile`)으로 채점한다.

<!-- bench:line -->
아직 실측 결과를 기록하지 않았다.

- `baseline`: dsmith 연결 없음. `audit → init --all`을 거친 같은 베이스에서 `.dsmith/`·AGENTS.md DS 섹션·MCP·슬래시 명령만 뺀 복사본
- `dsmith`: 같은 베이스에 `install` + `ai`를 끝낸 복사본
- 두 조건은 같은 베이스·같은 채점 기준(토큰·DS 컴포넌트·정책 스냅샷)·같은 에이전트 명령·같은 환경 변수로 돈다. 프롬프트는 stdin으로 넘기므로 `codex exec`처럼 stdin으로 프롬프트를 받는 명령이면 다른 에이전트로도 돌릴 수 있다(실측은 `claude -p`만 했다).

### 실행

```
pnpm -r build
pnpm bench -- --repo legacy-demo --agent "claude -p --output-format stream-json --verbose --model sonnet --max-turns 20 --max-budget-usd 0.5 --permission-mode acceptEdits --allowedTools mcp__dsmith --setting-sources project --no-session-persistence"
pnpm bench:replay                                                # 미리 받은 산출물을 채점만(네트워크·에이전트 없음)
pnpm bench:report -- --in results/<날짜>-legacy-demo.json        # 결과 JSON → 마크다운 보고서 + README 줄
```

실행은 레포 원본이 아니라 `os.tmpdir()` 아래 임시 복사본에서 하고, 채점 코드(`benchmarks/`)는 복사본에 넣지 않는다. 에이전트에는 `CLAUDE*` 환경 변수를 넘기지 않는 정리된 환경을 준다. 에이전트 출력에 채점 코드 경로가 보이면 그 실행에 `harnessPathSeen`을 표시하고 보고서에 경고를 쓴다. 결과 JSON·보고서·산출물은 `benchmarks/results/`에 남고, 산출물을 `bench:replay`와 같은 방식으로 다시 채점하면 같은 숫자가 나온다. 자세한 옵션과 폴더 구조는 [benchmarks/README.md](benchmarks/README.md).

### 지표

- 토큰 준수율 = `token / (token + hardcoded)` — 에이전트가 새로 쓴 스타일 값 중 토큰을 가리킨 비율. Tailwind 기본 스케일 클래스(`p-4`, `bg-blue-100`)는 분모에서 빼고 별도 행으로 센다
- 토큰 사용률 = `token / (token + hardcoded + tailwind 기본 스케일)`
- `knownToken` — token 중 베이스의 토큰 이름·프리셋 키를 실제로 가리킨 것(지어낸 변수 `var(--made-up)`는 제외)
- DS 외 컴포넌트 — `prefer-ds-component` finding 수. 이 밖에 DS 컴포넌트 사용, deprecated, 파싱 실패, 기대 파일 없음을 센다
- 바뀐 파일에서 새로 생긴 사용만 센다(수정 파일은 원래 있던 값을 빼고 비교 — `guard --ci`와 같은 방식)

### 주장하지 않는 것

- 프롬프트 수와 반복 횟수가 작은 단일 측정이다. 에이전트 출력은 비결정적이고 유의성 검정을 하지 않았으므로 "이번 실행에서 이렇게 나왔다"까지만 말한다.
- 채점은 dsmith 자신의 규칙 엔진이고, `dsmith` 조건의 에이전트는 같은 엔진(`lint_snippet`)을 쓸 수 있다. 같은 기준에 맞추도록 돕는 효과를 잰 것이지 독립 평가가 아니다.
- 렌더링·타입 검사는 하지 않았다. 코드가 화면에서 맞게 보이는지, `tokens.css`를 불러오는지는 측정 밖이다.
- `bench:replay`가 쓰는 산출물은 합성이다. 그 숫자는 채점 파이프라인 검증용이며 성능 근거가 아니다.

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

## AI 도구 연결

```
npx dsmith install       # 쓰는 AI 도구를 감지해 설치. 그 뒤 AI 도구를 다시 열고 /ds 로 시작
```

`install`은 AI 도구의 흔적을 찾아 그 도구에만 쓴다. 흔적이 없으면 `claude-code` + `agents-md`가 기본이다. 어떤 도구를 왜 골랐는지(레포의 흔적인지 홈의 흔적인지)는 출력 첫 줄에 나온다. 강제로 고르려면 `--tool <name>`(여러 번 가능), 전부 쓰려면 `--all`.

| 도구 | 감지 흔적 | 슬래시 명령 | MCP 등록 | `--global` |
| --- | --- | --- | --- | --- |
| `claude-code` | `.claude/`, `CLAUDE.md`, `~/.claude/` | `.claude/skills/ds*/SKILL.md` | `.mcp.json`의 `mcpServers.dsmith` (처음 쓸 때 승인을 묻는다) | `~/.claude/skills/`만. MCP는 `claude mcp add --scope user` 안내 |
| `codex` | `.agents/`, `.codex/`, `~/.codex/` | `.agents/skills/ds*/SKILL.md` | `.codex/config.toml`의 `[mcp_servers.dsmith]` 마커 블록 (신뢰한 프로젝트에서만 읽힌다) | `~/.agents/skills/`, `~/.codex/config.toml` |
| `cursor` | `.cursor/`, `~/.cursor/` | `.cursor/commands/ds*.md` | `.cursor/mcp.json` | 미지원 |
| `gemini` | `.gemini/`, `~/.gemini/` | `.gemini/commands/ds*.toml` | `.gemini/settings.json` | 미지원 |
| `agents-md` | `AGENTS.md` | 없음 — `AGENTS.md`의 마커 블록에 명령 표와 `npx dsmith … --json` 대체 명령 | — | 미지원 |

`codex`를 쓰면 `agents-md`가 함께 설치된다. Cursor의 명령 규약은 일부만 확인됐다 — 렌더러 상단 주석(`packages/agent-skill/src/renderers/`)에 확인 날짜·URL과 미확인 항목이 있다.

슬래시 명령은 CLI를 `--json`으로 실행해 읽고 설명하는 데까지만 한다. 판단은 CLI·MCP에 있다.

| 명령 | 하는 일 |
| --- | --- |
| `/ds` | 상태(0·1·2)를 감지하고 알맞은 단계(audit → decide → init → ai → migrate → guard, check)를 순서대로 안내 |
| `/ds-detect` | 스타일링 방식·DS·프레임워크·시작 상태 감지 결과 설명 |
| `/ds-audit` | 하드코딩 값·중복 컴포넌트 진단 결과 설명 |
| `/ds-decide` | 중복·지역 재정의 중 표준으로 삼을 것을 결정 카드로 비교하고, 사람이 고른 결과를 기록 |
| `/ds-check` | 파일의 하드코딩 값을 찾아 토큰으로 바꿀 수정안 제안 |
| `/ds-init` | `init --dry-run`으로 토큰 수·커버리지·스캐폴드를 보여주고, 확인 뒤 실제로 DS 초안을 만듦 |
| `/ds-ai` | `ai --dry-run`으로 카탈로그 요약을 보여주고, 확인 뒤 카탈로그와 AGENTS.md DS 섹션을 만듦 |
| `/ds-migrate` | `migrate --json`으로 계획(치환 수·건너뜀 사유·close 후보·예상 점수)을 보여주고, 확인 뒤 새 브랜치에 적용·커밋. 되돌리기 명령을 알려주고 PR은 사람이 연다 |
| `/ds-guard` | `guard init --dry-run`으로 쓸 파일과 ESLint 상태를 보여주고, 확인 뒤 스냅샷·ESLint 설정(·워크플로)을 만듦 |

MCP 서버 `dsmith`(`npx -y dsmith@<설치된 0.x 마이너> mcp` — 0.x는 마이너까지, 1.x 이상은 메이저까지 고정)가 AI 도구에 내는 도구 6개:

- `resolve_token` — 하드코딩 값에 가장 가까운 디자인 토큰과 신뢰도
- `lint_snippet` — 코드 조각의 하드코딩 스타일 값을 찾아 토큰 제안
- `search_component` — 하려는 일(예: "날짜 선택")에 맞는 컴포넌트 검색
- `get_component` — 컴포넌트의 props·사용 수·정의 파일(카탈로그가 있으면 카탈로그에서 답하고 `source: "catalog"`, 설명·폐기·사용 예를 더한다. 같은 이름이 여러 module이면 결정한 것 → DS·카탈로그 → 사용 수 순으로 고르고 `isDs`·`decided`를 싣는다)
- `explain_decision` — 중복·지역 재정의 항목의 결정 카드(옵션·차이·영향·추천)
- `list_decisions` — 결정할 항목과 이미 결정한 항목

서버는 `.dsmith/` 인덱스를 읽고, 없으면 첫 도구 호출 때 인덱스를 만든다(`audit`과 같은 분석). 서버를 띄운 폴더에서 위로 올라가며 `.git` 또는 `.dsmith/detect.json`·`index.json`이 있는 가장 가까운 폴더를 레포로 본다(`--global`이 홈에 남기는 `~/.dsmith/install.json`은 근거가 아니다). 도구 응답 하나는 추정 토큰 약 1,500 이하로 제한된다(목록은 `nextCursor`로 이어 받고, 큰 객체는 줄이고 `omitted`에 잘린 개수를 적는다). 바꾸려면 MCP 등록의 `args` 끝에 `--budget <tokens>`를 더한다(`dsmith mcp --budget 3000`). 결정은 사람이 고른 뒤 `dsmith decide --item <이름> --choose <id>`로만 기록한다 — MCP에는 쓰기 도구가 없다.

쓰기 규칙:

- `--dry-run`: 아무것도 쓰지 않고(매니페스트 포함) 쓸 파일과 diff만 보인다.
- 사용자가 고친 파일·블록은 덮어쓰지 않고 건너뛴다. 덮어쓰려면 `--force`. 해시는 `.dsmith/install.json`(`--global`이면 `~/.dsmith/install.json`)에 기록된다.
- 등록된 `.mcp.json`의 dsmith 항목을 직접 고치면(예: `--budget` 추가) 그 항목은 사용자 소유가 되어 이후 `install`이 건너뛴다. 건너뛴 설정 파일에는 직접 넣을 JSON/TOML이 "할 일"로 출력된다.
- 두 번째 실행은 아무것도 바꾸지 않는다. `AGENTS.md`·`.mcp.json`·`config.toml` 등 기존 파일은 dsmith 블록/키만 건드린다. Codex `config.toml`에 dsmith가 관리하지 않는 `[mcp_servers.dsmith]`가 이미 있으면 `--force`로도 쓰지 않는다.

### 로컬 개발에서 MCP 붙이기

배포 전(또는 이 레포를 개발하는 동안)에는 `npx dsmith`로 받을 패키지가 없다. 빌드한 바이너리를 `--mcp-command`로 주면 **MCP 서버 실행 명령과 슬래시 명령·`AGENTS.md` 안의 CLI 호출이 모두 그 빌드**를 쓴다. `package.json` 버전이 `0.0.0`인 로컬 빌드에서는 `--mcp-command`가 필수이고, 빠지면 이 빌드의 `dist/bin.js` 경로가 든 실행 예가 오류로 나온다.

```
pnpm install && pnpm -r build
node <abs>/packages/cli/dist/bin.js install --root <repo> --mcp-command "node <abs>/packages/cli/dist/bin.js"
```

그러면 `.mcp.json`은 `{ "command": "node", "args": ["<abs>/packages/cli/dist/bin.js", "mcp"] }`를 가리키고, `/ds-audit` 등은 `node <abs>/packages/cli/dist/bin.js audit --json`을 실행하라고 적힌다. 값은 공백으로 나뉘어 `command`와 `args`가 되고 끝에 `mcp`가 붙는다(따옴표는 지원하지 않아 공백이 든 경로는 쓸 수 없다). 이 경로는 이 컴퓨터에만 있으므로 레포 모드에서는 산출 파일(`.mcp.json`, `.claude/skills/`, `AGENTS.md` 등)을 커밋하지 말라는 경고가 나온다.

대안: `npm link`(또는 `pnpm link --global`)로 `packages/cli`를 연결해 `dsmith` 명령을 PATH에 올리고 `--mcp-command dsmith`를 준다 — `.mcp.json`은 `dsmith mcp`, 명령 본문은 `dsmith audit --json`이 된다. 경로가 파일에 들어가지 않는 대신 연결한 사람의 PATH에만 있다.

## 구조

- `packages/core` — 공통 모델(`StyleUsage`·`ComponentUsage`), 색·길이 정규화, TSX·CSS 선언 파서, 인덱서(`indexRepo`, `DEFAULT_EXCLUDE`), 색·간격 클러스터링, 토큰 매처, 컴포넌트 집계·검색, 토큰 로드, 결정 카드·기록, 안전한 파일 쓰기(`safeWrite`)
- `packages/extractor-api` — Extractor 계약(`ExtractorMeta`·`signals`, `JS_FILES`)과 `runConformance`
- `packages/detect` — 레포 감지(스타일링 방식·DS·프레임워크·Storybook·lint)와 시작 상태 판정, `.dsmith/detect.json`
- `packages/extractor-tailwind` — Tailwind `className` 유틸리티 클래스
- `packages/extractor-inline-style` — JSX `style={{ … }}`
- `packages/extractor-css` — `.css`·`.scss` 파일 선언
- `packages/extractor-styled` — styled-components 태그 템플릿·객체 인자(emotion과 공유하는 CSS-in-JS 파서 포함)
- `packages/extractor-emotion` — Emotion `css` 태그·`@emotion/styled`·`css` prop
- `packages/extractor-mui-sx` — MUI `sx` prop
- `packages/mcp-server` — MCP 서버(도구 6개·리소스 2개). core 함수를 부르는 얇은 핸들러와 응답 토큰 상한. 카탈로그는 core `readCatalog`로 읽는다
- `packages/init` — `dsmith init`: audit 결과로 W3C 토큰 파일·CSS 변수·TS 상수와 컴포넌트 골격을 쓰고 커버리지를 계산
- `packages/catalog` — `dsmith ai`: 로컬 DS·npm `.d.ts`·init 산출에서 컴포넌트 카탈로그를 만들고 AGENTS.md DS 섹션을 갱신
- `packages/migrate` — `dsmith migrate`: 토큰·결정 기반 치환 계획·적용·되돌리기, 컴포넌트 import 편집, git 브랜치 커밋
- `packages/guard` — `dsmith guard`: `.dsmith/guard.json` 스냅샷, `guard init`(ESLint 설정·워크플로), `guard --ci`(PR diff 검사·코멘트)
- `packages/eslint-plugin` — `@dsmith-dev/eslint-plugin`: 규칙 3개(core `evaluateFile` 위의 동기 래퍼)
- `packages/agent-skill` — 도구 중립 슬래시 명령 소스 9개와 AI 도구별 렌더러 5개(Claude Code·Codex·Cursor·Gemini CLI·AGENTS.md), 도구 감지
- `packages/cli` — `dsmith` 바이너리(`detect`·`audit`·`install`·`mcp`·`decide`·`init`·`ai`·`migrate`·`guard`), Extractor 레지스트리, 마크다운 리포트
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
