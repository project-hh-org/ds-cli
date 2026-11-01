# Plan 4 설계: 적용·방어·증명 (migrate · guard · benchmark)

- 날짜: 2026-11-01
- 상태: 승인 (Plan 3b 머지 뒤 실행)
- 상위 문서: `2026-10-31-ds-cli-design.md` §2 커맨드(migrate, guard), §5 벤치마크, §11 증명 방식. 3b가 남긴 입력: `replaceableToken(usage, tokens)`(core), `Extractor.write(usage, tokenRef)`, `DecisionRecord`, `catalog.json`, 토큰 파일 3종.
- 두 단계: **4a 적용·방어**(migrate + guard), **4b 증명**(benchmark + 실제 레포 전 구간 기록). 4a가 독립 출시 단위.

## 1. 4a — `dsmith migrate`

### 1.1 원칙

- **dry-run이 기본.** `migrate`는 계획(plan)을 만들고 보여준다. `--apply`가 있어야 파일을 쓴다. 적용 뒤에는 되돌릴 수 있는 기록(`.dsmith/migrations/<id>.json`: 파일별 원문 해시 + 패치 목록)을 남기고 `migrate --revert <id>`로 복구한다.
- **치환 규칙은 커버리지 규칙과 동일.** 치환 후보 = `replaceableToken(usage, tokens)`가 참인 hardcoded 사용. `init` 리포트의 "migrate 예상치"와 실제 치환 수가 같아야 한다(차이는 "쓸 수 없는 이유"로 전부 설명).
- **방식별 토큰 참조는 Extractor가 안다.** core는 `tokenRef`를 모른다. Extractor 메타에 `tokenRef(token, usage): string | null`을 추가해 각 방식의 참조 문자열을 만든다(아래 표). `null`이면 그 사용은 "참조 형식 없음"으로 건너뛴다.
- **컴포넌트 치환은 결정이 있어야만.** `decisions.json`의 `decided` duplicate/local-definition 항목만 대상. 선택지 간 props 이름이 다르면 `DecisionRecord.mapping?: Record<string, string>`(추가 필드, `/ds-decide`가 채움)이 없는 한 건너뛰고 사유를 낸다.
- **한 파일당 패치는 비중첩·역순 적용.** 같은 구간에 두 패치가 겹치면 둘 다 보류하고 사유를 낸다. 적용 후 그 파일을 다시 파싱해 구문 오류가 나면 그 파일 전체를 되돌린다(원자성은 파일 단위).

### 1.2 토큰 참조 형식 (Extractor별)

| Extractor | 토큰 소스가 CSS 변수 (`tokens.css`/DS 토큰 파일) | 토큰 소스가 Tailwind 테마 |
| --- | --- | --- |
| css / scss | `var(--color-blue-400)` | — |
| inline-style | `"var(--color-blue-400)"` | — |
| styled / emotion (템플릿) | `var(--color-blue-400)` | — |
| styled / emotion (객체) | `"var(--color-blue-400)"` | — |
| mui-sx | 색: `"var(--color-blue-400)"`; 간격: 숫자 스케일이 있으면 `2`(8px 기준) — 테마 `spacing`이 토큰 값과 맞을 때만, 아니면 `"var(--space-2)"` | — |
| tailwind | **프리셋이 있으면** 클래스명(`bg-blue-400`, `p-2`); 없으면 임의값 `bg-[var(--color-blue-400)]` | `init`이 `design-system/tailwind.preset.{js,ts}`를 추가로 생성(4a Task 1): `theme.extend.colors/spacing/borderRadius/fontSize`를 토큰에서 → `migrate`는 프리셋이 `tailwind.config`에 연결돼 있을 때만 클래스명 치환, 아니면 임의값 + "프리셋을 연결하면 클래스명으로 바뀜" 안내 |

Tailwind 기본 팔레트 클래스(`bg-blue-500`, `tailwind-default` 소스)는 치환 대상이 아니다(이미 토큰). 단, 프로젝트 프리셋이 같은 이름을 다른 값으로 재정의하면 `guard`가 잡는다(아래).

### 1.3 입력·출력

- 입력: 최신 인덱스(없으면 audit 1회), `loadTokens`(토큰 파일 > 카탈로그 토큰 > 제안 토큰은 **제외** — 제안 토큰으로는 치환하지 않는다; 상태 0은 `init` 먼저), `decisions.json`, 활성 Extractor.
- 범위 옵션: `--files <glob…>`, `--category color|spacing|radius|font-size`, `--only tokens|components`, `--min-confidence exact|close`(기본 close), `--max-files <n>`.
- 계획 출력(`--json` 동일 구조): 파일별 패치 수, 카테고리별 치환 수, 건너뜀 사유별 수(`no-token-ref`, `overlap`, `dynamic`, `far`, `decision-pending`, `mapping-missing`), 예상 커버리지 변화(전/후 hardcodedShare, 점수).
- `--apply`: 패치 적용 → 파일별 재파싱 검증 → `.dsmith/migrations/<timestamp>.json` 기록 → 요약. `--apply --branch <name>`이면 git 브랜치를 만들고 커밋까지(메시지 `chore(ds): 하드코딩 N건을 토큰으로 치환 (dsmith migrate)`), PR은 열지 않는다(사용자가 연다 — 공개 표면).
- `--revert <id>`: 기록의 파일 해시가 현재와 같을 때만 되돌림(사용자가 그 뒤 수정했으면 그 파일은 건너뜀 + 사유).
- 적용 뒤 `audit`을 다시 돌려 before/after를 `.dsmith/reports/migrate-<date>.md`에 적는다(점수·hardcodedShare·카테고리별 잔여).

### 1.4 컴포넌트 치환 (결정 기반)

- duplicate 결정 `chosen = M`: 다른 모듈에서 온 `<Name …>` 사용의 import 지정자를 `M`으로 바꾼다(기존 import 문에 합치거나 새로 추가, 미사용 import 제거). props 차이는 `mapping`으로 이름만 바꾸고, 값 차이(`variant="primary"`→`"default"`)는 `mapping`의 `"prop=value"` 키로 받는다. 둘 다 없으면 보류.
- local-definition 결정 `chosen = 파일 F`: 다른 파일의 동명 지역 선언은 **삭제하지 않는다**. 대신 `import { Name } from "<F의 module>"`을 추가하고 지역 선언에 `// dsmith: F로 통합됨 — 삭제 검토` 주석만 단다(삭제는 사람이).
- token-cluster 결정은 토큰 치환 경로가 이미 처리한다(`chosen` hex가 대표값).

### 1.5 검증

- 픽스처별 e2e: `tailwind-app`(임의값 → 프리셋 연결 후 클래스명), `inline-app`, `styled-app`, `emotion-app`, `mui-app`(sx 숫자 스케일), `with-ds-app`(CSS 변수 토큰 파일), `legacy-demo`(init 뒤 migrate; 예상치 = 실제 치환 수; 적용 후 점수 상승; `--revert`로 원복 → 트리 해시 동일).
- 모든 적용 결과는 각 Extractor의 conformance에 "write 왕복" 케이스로 고정: 치환 후 재추출하면 그 사용이 `token`으로 바뀌고 다른 사용은 그대로.
- 겹침·동적·구문 오류 롤백 케이스.

## 2. 4a — `dsmith guard`

### 2.1 두 표면, 한 규칙 엔진

| 표면 | 역할 | 입력 |
| --- | --- | --- |
| `eslint-plugin-dsmith` (`@dsmith-dev/eslint-plugin`, ESLint 9 flat config, 규칙 `dsmith/no-hardcoded-style`, `dsmith/prefer-ds-component`, `dsmith/no-deprecated-component`) | 사람이 코드를 쓸 때 즉시 | 파일 하나 — Extractor를 **동기**로 호출(모든 Extractor의 `extract`는 이미 동기; 토큰/카탈로그는 플러그인 초기화 때 `.dsmith/guard.json`에서 동기 로드) |
| `dsmith guard --ci` | PR 단위 드리프트 | `--base <ref>`와의 diff에 포함된 파일만 인덱싱 → 신규 hardcoded 사용 수, 신규 비-DS 컴포넌트, deprecated 사용 → 마크다운 코멘트 본문 + 종료 코드(임계 초과 시 1) |

- 규칙 엔진은 core `rules/`에 둔다: `evaluateFile({ usages, components, tokens, catalog, policy }) → Finding[]` (순수). ESLint 플러그인과 `--ci`와 MCP `lint_snippet`이 **같은 함수**를 쓴다(§5 "같은 엔진"). `lint_snippet`은 이 함수로 교체한다(출력 호환 유지).
- `.dsmith/guard.json`: `guard init`(또는 `install --guard`)이 생성 — 토큰(CSS 변수·카탈로그) 스냅샷, DS 모듈 목록, deprecated 목록, policy(`allow: { files: glob[], properties: [] }`, `minConfidence`, `failOn: { newHardcoded: n, deprecated: 0 }`). 플러그인은 이 파일만 읽는다(비동기 없음, 빠름). 스냅샷이 토큰 파일보다 오래되면 `guard --ci`가 경고(3b의 해시 검증 재사용).
- 자동 수정: `no-hardcoded-style`은 `tokenRef`가 있고 confidence가 `exact`인 경우에만 ESLint `fix`를 제공(`close`는 suggestion).
- 설치: `dsmith guard init`이 ESLint flat config를 감지해 `eslint.config.{js,mjs,ts}`에 플러그인 import + 규칙 블록을 **마커 주석 사이**에 추가(safeWrite 마커 블록, JS 파일이므로 `/* dsmith:start */`…`/* dsmith:end */`); 레거시 `.eslintrc*`면 안내만. Biome/oxlint 감지 시 "ESLint 전용" 안내.
- CI 템플릿: `dsmith guard init --ci github`가 `.github/workflows/dsmith-guard.yml`을 생성(PR에서 `npx dsmith guard --ci --base origin/${{ github.base_ref }} --comment`; 코멘트는 `GITHUB_TOKEN`으로 PR에 1개 upsert — 마커로 자기 코멘트만 갱신).

### 2.2 검증

- 플러그인 단위 테스트는 ESLint `RuleTester`(flat)로 픽스처 코드 조각 — Tailwind 임의값, inline, styled 템플릿, sx 숫자, css 파일(ESLint는 JS만 — css는 `--ci` 경로만).
- `guard --ci`: 임시 git 레포에서 base 커밋 뒤 hardcoded를 추가한 커밋 → 신규 N 검출, 임계 초과 종료 코드 1, 코멘트 본문 스냅샷; 토큰으로 바꾼 커밋 → 0.
- legacy-demo에 `migrate --apply` 뒤 `guard --ci`가 0건, 그 뒤 하드코딩 재유입 커밋에 1건.

## 3. 4b — 벤치마크와 증명

### 3.1 벤치마크 하네스 (`benchmarks/`)

- 프롬프트 N=12(UI 생성: 폼·모달·리스트·카드·테이블·배지 등, 각각 "이 레포 스타일로"). 대상 레포: `legacy-demo`(init+ai 완료 상태)와 `with-ds-app`.
- 실행기: `benchmarks/run.ts`가 **외부 에이전트 명령**을 받는다(`--agent "claude -p"`, `--agent "codex exec"` 등 — 하네스는 명령 문자열에 프롬프트를 stdin으로 넘기고 결과 파일을 수집). 두 조건: `baseline`(AGENTS.md DS 섹션·MCP 없음 — install 안 한 복사본) / `dsmith`(install + ai 완료 복사본). 각 조건·프롬프트당 1회(결정적이지 않으므로 N과 반복 횟수를 결과에 명시).
- 채점: 생성된 파일을 `core rules/evaluateFile`로 — 하드코딩 사용 수, 비-DS 컴포넌트 사용 수, deprecated 사용, 토큰 참조 수 → `benchmarks/results/<date>.json` + 마크다운 표("토큰 준수율 X% → Y%, DS 외 컴포넌트 생성 n → m").
- 에이전트 바이너리가 없는 환경(이 컨테이너)에서는 `--agent` 대신 `--replay <dir>`로 미리 받은 산출물을 채점만 한다. 컨트롤러는 가능한 환경에서 1회 실제 실행을 시도하고, 불가하면 "재생 모드로 채점 파이프라인만 검증"이라고 기록한다.

### 3.2 실제 레포 전 구간 기록

- 비공개 레포 복사본에 상태 1 기준 `audit → init(--dry-run) → decide(추천 자동 N건) → migrate(계획, 범위 제한 적용 1회) → guard --ci` 를 돌려 before/after를 `docs/decisions/2026-11-xx-real-repo-end-to-end.md`에 익명으로 기록(사용자 OK 받음). 숫자 형태는 §11: "하드코딩 색 N개 → 토큰 M개, 중복 Button k → 1, 재유입 0건".
- 공개 데모 레포(`examples/legacy-demo`)에는 같은 과정을 **커밋으로 남긴다**(migrate가 만든 브랜치 포함) — 면접에서 보여줄 수 있는 실물.

## 4. 공통 결정

- 패키지: `packages/migrate`(`@dsmith-dev/migrate`), `packages/eslint-plugin`(`@dsmith-dev/eslint-plugin`, npm `eslint-plugin-dsmith`는 이름 충돌 확인 뒤 별칭 배포 여부 결정 — 기본은 스코프 패키지), `packages/guard`(`@dsmith-dev/guard`: `--ci`, `guard init`, guard.json), `benchmarks/`(비공개 워크스페이스, 배포 안 함). core 추가: `rules/`, `patch/`(비중첩 패치 적용·재파싱 검증), `migrations/`(기록·revert).
- Extractor 계약 확장(추가 필드): `tokenRef?(token: Token, usage: StyleUsage, ctx: { preset?: TailwindPreset }): string | null`. 없으면 migrate가 그 Extractor의 사용을 `no-token-ref`로 건너뜀. conformance에 `write`+`tokenRef` 왕복 케이스 추가.
- 슬래시: `/ds-migrate`(계획 → 사람 확인 → `--apply --branch`), `/ds-guard`(guard init + ci 템플릿), `/ds-check`는 `evaluateFile` 기반으로 그대로. `/ds` 상태 1 경로에 migrate·guard를 잇는다.
- MCP 쓰기 도구는 여전히 없음. `lint_snippet`만 규칙 엔진으로 교체.
- 버전: 4a 머지 → 다음 마이너, 4b → 그다음 마이너(벤치마크 결과는 README 상단 한 줄).
- 범위 밖: render-diff(`/ds-compare`), `usage` 대시보드, Figma 소스, 자동 PR 생성, 삭제 코드모드.

## 5. 증명 포인트

- "init이 예상한 커버리지 X%와 migrate가 실제로 바꾼 수가 같다 — 같은 함수(`replaceableToken`)다."
- "사람이 쓰면 ESLint가, AI가 쓰면 MCP가, PR이면 CI가 같은 규칙 엔진으로 막는다."
- "벤치마크: 같은 프롬프트 12개, dsmith 있을 때 토큰 준수율 X% → Y%."
