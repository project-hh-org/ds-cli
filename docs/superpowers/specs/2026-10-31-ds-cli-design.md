# dsmith 설계 스펙

작성일: 2026-10-31
상태: 승인 (2026-10-31, 셀프 리뷰 반영: install/ai 경계, 건강 점수 정의)

> 도구 이름: dsmith (DS + smith — 디자인 시스템을 만들고 다듬는 도구). npm: `dsmith`, 스코프 `@dsmith/*`.

## 1. 목적

디자인시스템(DS)의 도입·정리·재구축·운영·AI 연동 전부를 **도구 하나와 실제 레포 적용 숫자**로 증명한다.

- 채용 공고의 "DS 경험"은 대부분 토큰 파이프라인 + Storybook + 컴포넌트 라이브러리를 뜻하고, 지원자 포트폴리오도 거기서 끝난다. "만드는 것"은 포화 상태다.
- 차별화는 만든 뒤에 생기는 고통(검증·운영·AI 시대의 사용성)에서 나온다.
- 타겟 회사: DS가 없는 곳(첫 도입)부터 운영 중인 곳까지 전부. 도구는 시작 상태를 가리지 않는다.
- 경력 연결: 알마니에서 Figma 네이밍 정렬 DS + 커스텀 MCP로 디자이너 없이 어드민을 구현한 경험을 "한 회사용"에서 "어떤 DS에나 붙는 범용 도구"로 일반화한다.

## 2. 시작 상태 3가지, 파이프라인 하나

어느 상태에서 시작하든 같은 커맨드 열을 타고, 달라지는 것은 진입 지점뿐이다. 어느 커맨드든 먼저 `detect`가 레포를 읽어 스타일링 방식·DS 유무·시작 상태를 정하므로 설정 파일 없이 시작한다.

| 시작 상태 | audit가 하는 일 | 그 다음 |
| --- | --- | --- |
| 0. DS 없음 (첫 도입) | 코드에서 사실상의 토큰·반복 UI를 역설계 | `init`으로 DS 패키지 생성 → migrate → guard → ai |
| 1. DS 있지만 안 지켜짐 (정리/재구축) | 기존 DS 기준으로 이탈·중복 측정 | migrate → guard → ai |
| 2. DS 운영 중 | 건강도 점검 | guard · usage · ai |

`init`은 완성된 DS가 아니라 **측정에 근거한 초안**을 만든다. 사람이 이름을 다듬고 승인하면 v0.1이 되고, 이후는 상태 1과 동일하다.

### 커맨드

| 커맨드 | 역할 | 산출물 |
| --- | --- | --- |
| `install` | 사용 중인 AI 도구를 감지해 슬래시 명령(`/ds-*`)과 MCP 서버를 등록. DS 유무와 무관, 보통 가장 먼저 | 도구별 스킬/명령 파일, MCP 설정 |
| `detect` | 레포를 읽어 스타일링 방식, DS 유무·위치, 프레임워크, 시작 상태를 판별 (모든 분석 커맨드가 먼저 실행) | `.dsmith/detect.json` — 활성 Extractor, DS 소스 어댑터, 시작 상태 |
| `audit` | 하드코딩 색·간격·폰트 분포, 중복 컴포넌트 탐지, 색상 클러스터링으로 토큰 후보 추출 | 리포트 1장: DS 건강 점수, 토큰 후보표, 통합 대상 컴포넌트 |
| `init` | audit 결과로 토큰 파일 + 컴포넌트 스캐폴드 생성 | DS 패키지 초안 |
| `migrate` | 하드코딩 값 → 토큰 치환 codemod, 중복 컴포넌트 → 표준 컴포넌트 매핑 | 변경 PR |
| `guard` | ESLint 규칙(하드코딩 재유입 차단), CI 드리프트 검사 | lint 패키지, CI 리포트 |
| `ai` | DS 소스에서 컴포넌트 카탈로그를 빌드하고 `AGENTS.md`·스킬에 이 레포의 DS 규칙을 주입. MCP 서버는 이 카탈로그를 읽음 (DS가 생긴 뒤, `install` 이후) | `.dsmith/catalog.json`, `AGENTS.md` DS 섹션 |
| `usage` | 컴포넌트·variant·토큰별 사용량 집계 | 대시보드 (deprecated 제거 판단) |

`install`과 `ai`의 경계: `install`은 도구 등록(어느 레포에서나 같은 파일), `ai`는 이 레포의 DS 내용(레포마다 다른 파일). 상태 0에서는 `install` → `detect` → `audit` → `init` → `ai` 순이 된다.

DS 건강 점수: 하드코딩 값 비율, DS 컴포넌트 import 비율, 중복 컴포넌트 수의 가중 합. 가중치와 산식은 구현 계획에서 확정하고 리포트에 산식을 함께 표기한다.

## 3. 감지 단계 — 에이전트가 코드를 읽고 정하는 것

스타일링 방식, DS 유무, 프레임워크 같은 값은 사람이 미리 정하는 가정이 아니라 `detect`가 레포를 읽고 판단하는 감지 항목이다. 감지 결과는 기록으로 남아 모든 커맨드와 MCP가 공유하고, 사람은 틀린 감지만 고친다. 혼용 레포에서는 Extractor 여러 개가 동시에 켜진다.

| 감지 항목 | 판단 근거 | 결과로 정해지는 것 |
| --- | --- | --- |
| 스타일링 방식 (혼용 포함) | `package.json` 의존성, `tailwind.config`, `*.module.css`, `styled`/`css` 태그 함수, `style={{}}` 비율 | 켜는 Extractor와 각각의 비중 |
| DS 유무와 위치 | DS로 보이는 의존 패키지, `components/ui` 같은 공용 디렉터리, 토큰 파일(CSS 변수, theme 객체) | DS 소스 어댑터 (npm / 로컬 / bootstrap) |
| 시작 상태 (0·1·2) | DS 유무 + DS 컴포넌트 import 비율 + 하드코딩 비율 | 진입 커맨드 (init이 필요한지) |
| 프레임워크·라우팅 | Next.js / Vite / RN, app 또는 pages 디렉터리 | 화면 단위 집계 기준 (영향 화면 수 계산용) |
| 컴포넌트 디렉터리 규약 | 파일명·export 패턴, index 배럴 | `ComponentUsage` 수집 범위 |
| Storybook 유무 | `.storybook/`, `*.stories.*` | 렌더 diff 소스 (없으면 임시 하네스) |
| 기존 lint 설정 | ESLint/oxlint/Biome 설정 파일 | guard 규칙을 꽂는 자리 |
| 중복 컴포넌트 후보 | 이름 유사·props 유사·렌더 유사 | audit의 클러스터링 시작점 |

## 4. 아키텍처

엔진은 스타일링 방식을 모르고, 방식마다 Extractor 하나만 추가하면 모든 커맨드가 그대로 동작한다. "새 스타일링 지원 = 파일 하나 추가"가 그 자체로 면접 포인트다.

```
Extractor 플러그인 (detect가 감지한 방식만 켬)   DS 소스 어댑터 (npm / 로컬 / bootstrap / Figma)
                      │                                         │
                      └──────────────┬──────────────────────────┘
                                     ▼
                  정규화 모델  StyleUsage[] · ComponentUsage[]  (스타일링 방식과 독립)
                                     ▼
                  Core  토큰 매처 · 클러스터링 · 유사도 · lint 규칙 · 컴포넌트 카탈로그
          ┌──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐
         CLI        init      guard        ai       usage     에이전트/스킬
     audit/migrate  생성기   ESLint/CI  MCP+AGENTS  대시보드   비교 문서·결정 진행
```

- **Extractor 플러그인**: `파일 → StyleUsage[]` 하나만 구현. 색·간격·폰트를 공통 단위(hex/oklch, px, rem)로 정규화. 역방향 `write(usage, token)`도 가져서 migrate가 방식별로 맞게 치환(Tailwind는 클래스명, CSS Modules는 `var(--token)`).
- **정규화 모델**: `StyleUsage {file, loc, property, raw, normalized, source}` + `ComponentUsage[]`(JSX 컴포넌트 사용). 중복 컴포넌트 탐지와 usage 대시보드가 여기 붙는다.
- **Core**: 매처(raw → 가장 가까운 토큰), 클러스터링, lint 규칙, 컴포넌트 카탈로그. 정규화 모델만 보며 스타일링 방식과 완전히 분리.
- **6개 표면**: CLI(audit/migrate) · ESLint/CI(guard) · MCP+AGENTS.md(ai) · usage 대시보드 · 생성기(init) · 에이전트/스킬. 모두 Core 함수를 감싼 어댑터라 커맨드를 추가하면 MCP 도구도 거의 공짜로 따라온다.

### DS 소스 어댑터

| 소스 | 용도 |
| --- | --- |
| npm 패키지 | shadcn, Mantine, 사내 DS 패키지 — 어떤 회사에 가도 바로 붙임 |
| 로컬 컴포넌트 디렉터리 | 패키지화 안 된 사내 DS |
| bootstrap (없음 → 생성) | audit 결과로 토큰 파일 + 컴포넌트 스캐폴드를 생성, 상태 0의 진입점 |
| Figma (후순위) | 디자인 토큰을 기준으로 삼을 때 |

## 5. MCP 설계 기준

MCP는 guard의 하위 기능이 아니라 독립된 표면이고, 따로 짜는 게 아니라 **같은 엔진의 함수를 AI에게 노출**한다. 그래야 문서가 코드와 어긋나지 않는다.

### 도구는 적고 날카롭게

| Tool | 역할 | 엔진 재사용 |
| --- | --- | --- |
| `search_component(intent)` | "날짜 고르는 입력" → `DatePicker` 후보 + 선택 이유 | 컴포넌트 인덱스 |
| `get_component(name)` | props/variants, 접근성 요구, do/don't, 최소 예시 1개 | TS 타입 + 스토리에서 생성 |
| `resolve_token(raw)` | `#3B82F6` → `color.primary.500` (거리·신뢰도 포함) | audit의 매처 그대로 |
| `lint_snippet(code)` | AI가 쓴 코드의 DS 위반 목록 | guard의 규칙 그대로 |
| `get_pattern(context)` | 폼·모달·리스트 같은 조합 패턴 | 패턴 카탈로그 |
| `explain_decision(item)` | "결정 필요" 항목 하나를 근거까지 분석해 결정 카드로 반환 | audit 인덱스 + 사용처 집계 + 매처 |

핵심은 `lint_snippet`. 에이전트가 코드를 내놓기 전에 스스로 검사하고 고치는 루프가 생기고, 이게 준수율을 숫자로 만드는 장치다.

### 코드에서 생성

- props는 TS 타입에서, 예시는 Storybook 스토리에서, deprecated는 JSDoc 메타에서 추출
- DS 패키지 버전이 올라가면 MCP도 같이 올라감 — 드리프트 불가
- `install`이 MCP 서버와 슬래시 명령을 등록하고, `ai`가 이 레포의 DS 카탈로그와 `AGENTS.md` DS 섹션을 생성·갱신

### 컨텍스트 예산

- 점진 공개: `search`는 이름 + 한 줄만, `get`에서 상세. 응답은 compact JSON, 응답당 토큰 상한
- 리소스(`tokens://`, `components://`)는 목록만, 본문은 요청 시

### 벤치마크

- UI 생성 프롬프트 N개 → MCP 없이 / 있이 에이전트 실행 → `guard`로 위반 수 측정
- 산출물: "토큰 준수율 X% → Y%, DS 외 컴포넌트 생성 0건" 형태의 한 줄

## 6. 에이전트·스킬 레이어 — DS를 "잡아주는" 역할

CLI는 측정을 하고, 에이전트는 판단을 돕는다. 스킬이 CLI 커맨드와 MCP 도구를 엮어 **사용 중인 컴포넌트를 전부 뽑고 → 비슷한 것을 묶고 → 사람이 결정할 항목만 남기는** 흐름을 끝까지 진행한다.

참고 산출물: 기존 어드민 콘솔의 공용 컴포넌트와 DS 패키지를 소스 기준으로 나란히 그린 "콘솔 vs 디자인 시스템 컴포넌트 비교" 문서. 이 레이어가 자동으로 내야 할 결과의 형태다.

| 그 문서에 있는 것 | 에이전트가 자동화하는 방법 |
| --- | --- |
| 컴포넌트별 import 수 | `audit`의 `ComponentUsage[]` 집계 |
| 콘솔 → DS 대응표 (하나가 여러 개로 갈리거나 "없음" / "콘솔만") | 유사도 클러스터링 + 에이전트의 매핑 제안 |
| variant별 나란히 렌더 + 판정 칩 (같음 / 차이 / 결정 필요 / 한쪽만) | Storybook 또는 임시 하네스에서 스크린샷 → 픽셀·토큰 diff |
| "먼저 결정할 네 가지" | 자동으로 못 정하는 항목을 추리되, 항목마다 MCP로 코드를 읽어 근거까지 분석한 결정 카드를 붙여 사람에게 넘김 |

### 결정 카드

"결정 필요" 항목은 이름만 남기지 않고 `explain_decision`이 항목마다 아래를 채워서 낸다. 사람은 분석을 하는 게 아니라 고르기만 한다.

| 필드 | 내용 | 출처 |
| --- | --- | --- |
| 무엇이 다른가 | 양쪽 구현의 실제 값 차이 | 소스 디프 + 렌더 diff |
| 어디서 쓰이나 | 각 변종의 사용처 파일·화면 목록과 수 | `ComponentUsage[]` |
| 바꾸면 어디까지 번지나 | 선택지별 영향 화면 수, 수정해야 할 호출 수 | 인덱스 역추적 |
| 규칙상 근거 | 토큰 규칙·접근성 기준(대비율 등)에 어느 쪽이 맞는지 | 매처 + a11y 검사 |
| 역사 | 차이가 생긴 커밋·PR과 그 사유 | git blame · PR 설명 |
| 추천안 | 위 근거로 에이전트가 제안하는 쪽과 이유, 확신도 | 에이전트 해석 |

사람의 선택은 기록으로 남아 `migrate`의 입력이 되고, 같은 유형의 차이가 다시 나오면 이전 결정을 근거로 자동 판정으로 내려간다.

### 유사 컴포넌트를 묶는 신호 3가지

- 구조: JSX 트리 모양, props 시그니처, 사용하는 토큰 집합
- 시각: variant별 렌더 스크린샷의 유사도 (크기·색·모서리·간격)
- 사용 맥락: 같은 화면에서 같은 자리에 쓰이는지, import하는 쪽이 겹치는지

### 스킬이 타는 흐름

1. `audit` 실행 → 컴포넌트 인덱스와 유사도 후보 확보
2. 후보를 묶어 대응표 초안 작성, 각 묶음에 표준 이름 제안
3. variant별 나란히 렌더한 비교 문서 생성
4. 자동 판정이 안 되는 항목은 `explain_decision`으로 하나씩 분석해 결정 카드를 만들고, 추천안과 함께 사람에게
5. 사람이 결정하면 그 결과가 `init`(상태 0) 또는 `migrate`(상태 1)의 입력이 되고, 결정 기록은 다음 판정의 근거로 재사용

## 7. 실행 방식 — 슬래시 명령이 기본 진입점

설치 후에는 Claude Code·Codex 같은 AI 도구에서 `/ds-*` 슬래시 명령으로 바로 실행한다. 터미널 `npx dsmith <커맨드>`는 같은 일을 하는 두 번째 진입점, CI는 세 번째다.

```bash
npx dsmith install          # 한 번 — 사용 중인 AI 도구를 감지해 슬래시 명령 + MCP 등록
npx dsmith install --global # 레포 무관하게 사용자 레벨에 등록
```

| 슬래시 명령 | 하는 일 | 내부에서 부르는 것 |
| --- | --- | --- |
| `/ds-detect` | 감지 결과를 보여주고 틀린 거 고칠지 묻음 | `detect` |
| `/ds-audit` | 진단 리포트 생성 + 요약 설명 | `audit` |
| `/ds-compare` | 유사 컴포넌트 묶기 → variant 비교 문서 | `audit` + `render-diff` |
| `/ds-decide` | 결정 필요 항목을 결정 카드로 하나씩 진행, 선택 기록 | MCP `explain_decision` |
| `/ds-init` | 결정 기록을 입력으로 DS 초안 생성 (상태 0) | `init` |
| `/ds-migrate` | dry-run → 확인 → codemod 적용 → PR | `migrate` |
| `/ds-guard` | lint·CI 등록 | `guard` |
| `/ds-check` | 현재 diff 또는 지정 파일의 DS 위반 검사 | MCP `lint_snippet` |
| `/ds-usage` | 사용량 대시보드 실행 | `usage` |
| `/ds` | 전체를 상태에 맞게 순서대로 진행 ("이 레포 DS 잡아줘") | 에이전트 스킬 본체 |

- **슬래시 명령은 얇게**: 본문은 "CLI를 `--json`으로 실행하고 결과를 설명하라, 판단이 필요하면 MCP 도구 X를 써라" 수준. 로직은 전부 CLI와 Core에 있어서 어느 AI 도구에서 불러도 결과가 같다.
- **한 소스, 도구별 출력**: 명령 정의는 `packages/agent-skill/commands/*.md` 하나고, `install`이 감지된 도구의 규약으로 렌더해 내려쓴다. 도구별 규약은 자주 바뀌므로 렌더러를 파일 하나씩 분리하고 구현 시점에 각 도구의 현재 스펙을 확인한다.

| AI 도구 | 내려쓰는 위치 | 비고 |
| --- | --- | --- |
| Claude Code (터미널 · VS Code · Desktop의 Code 탭) | `.claude/skills/ds-<cmd>/SKILL.md`, `.mcp.json` | 스킬이 `/ds-<cmd>`로 노출. `--global`은 `~/.claude/skills/` 또는 플러그인 마켓플레이스 |
| Claude Desktop (일반 채팅) | `claude_desktop_config.json`의 `mcpServers` 또는 `.mcpb` 배포 | MCP만 자동. 스킬은 zip 생성 + 수동 업로드 1회 |
| Codex | `.agents/skills/ds-<cmd>/SKILL.md`, `AGENTS.md` 섹션, MCP 설정 | Agent Skills 공통 형식 |
| Cursor | `.cursor/commands/ds-<cmd>.md`, MCP 설정 | |
| Gemini CLI | `.gemini/commands/ds-<cmd>.toml` | |
| 그 외 | `AGENTS.md`만 | 슬래시 명령 없이 문장으로 호출 |

설치 후 일상: 사람이 코드를 쓰면 `guard`(ESLint)가, AI가 코드를 쓰면 MCP가 백그라운드에서 DS를 지킨다. CI는 `npx dsmith guard --ci`가 PR 코멘트로 재유입을 보고한다.

## 8. 배포 방식

npm 공개. 사용자가 설치하는 단위와 레포 안 패키지 단위를 분리한다.

| 설치 단위 | 패키지 | 포함 |
| --- | --- | --- |
| CLI | `dsmith` | core + detect + 기본 Extractor 번들 — `npx` 한 번에 동작 |
| lint | `eslint-plugin-dsmith` | ESLint 표준 네이밍 |
| MCP | `@dsmith/mcp` (또는 `npx dsmith mcp`) | 단독 바이너리 |
| 추가 Extractor | `@dsmith/extractor-*` | detect가 감지했는데 미설치면 설치 안내 |
| 플러그인 계약 | `@dsmith/extractor-api`, `@dsmith/ds-source-api` | 제3자 Extractor 제작용 |

- 스킬·슬래시 명령·AGENTS.md는 `install`이 내려쓰므로 별도 배포 없음. Claude Code 전역 설치용 플러그인 레포만 따로
- 버전 관리 changesets, GitHub Actions에서 `npm publish --provenance`, 0.x로 시작, MIT, 처음부터 public
- 피할 것: 패키지 하나로 전부 묶기(플러그인 서사가 안 보임), 전부 쪼개서 `npx`가 안 되게 만들기

## 9. 레포 구조

pnpm 워크스페이스 모노레포.

```
dsmith/
├─ package.json / pnpm-workspace.yaml / tsconfig.base.json
├─ packages/
│  ├─ core/                 # 정규화 모델, 인덱스, 정규화, 매처, 클러스터링, 카탈로그, 규칙, 결정 카드
│  ├─ extractor-api/        # Extractor 계약 + conformance 테스트
│  ├─ extractor-tailwind/
│  ├─ extractor-inline-style/
│  ├─ extractor-css-modules/  (이후)
│  ├─ extractor-styled/       (이후)
│  ├─ ds-source-api/        # DS 소스 어댑터 계약
│  ├─ ds-source-npm/ · ds-source-local/ · ds-source-bootstrap/
│  ├─ detect/
│  ├─ render-diff/          # variant 스크린샷 + diff (Playwright)
│  ├─ cli/                  # npx dsmith — commands/, report/
│  ├─ eslint-plugin/
│  ├─ mcp-server/           # tools/, resources/, budget.ts
│  ├─ agent-skill/          # commands/*.md (한 소스), renderers/ (도구별), templates/
│  └─ dashboard/
├─ fixtures/                # tailwind-app · inline-app · mixed-app · with-ds-app
├─ benchmarks/              # prompts/, run.ts, score.ts
└─ docs/superpowers/specs/, docs/decisions/ (ADR)
```

대상 레포에 남는 파일: `.dsmith/detect.json`, `.dsmith/index.json`, `.dsmith/decisions.json`, `.dsmith/reports/*`, `AGENTS.md`, `.claude/skills/ds-*/SKILL.md`, `.mcp.json`, `eslint.config.*` 수정.

## 10. 범위 통제

MVP는 `detect` + `audit`. 읽기 전용 분석기 + 리포트라 그 자체로 면접 자료가 된다.

MVP 구현 순서:

1. `extractor-api` — 계약과 conformance 테스트
2. `core/model` + `core/normalize` + `core/index`
3. `extractor-inline-style` → `extractor-tailwind` (데모 레포 감지 결과에 따라 순서 조정)
4. `detect`
5. `core/cluster` + `core/match`
6. `cli` — `detect`, `audit` 커맨드와 audit 리포트
7. `fixtures/` 4개로 테스트 고정

이후 단계별 추가: `init` → `migrate` → `guard` → `ai`(MCP·슬래시) → `render-diff`·`agent-skill` → `usage` → `benchmarks`. 각 단계가 독립 출시·데모 가능해야 한다.

## 11. 증명 방식

공개 레거시 레포(DS 없는 것) 1개에 상태 0부터 끝까지 적용하고, 단계별 before/after 숫자와 의사결정 기록을 남긴다.

- 대상 선정 기준: React 계열, Tailwind 또는 inline style 비중 높음, DS 없음
- 숫자 형태: "하드코딩 색 N개 → 토큰 M개로 수렴, 중복 Button 5개 → 1개, 이후 PR에서 재유입 0건"
- MCP 유무 준수율 벤치마크 결과
- 의사결정 기록(ADR): 각 단계에서 무엇을 왜 선택했는지 — 면접 답변 자료

## 12. 구현 전제와 미결 사항

구현 전제(감지 대상이 아닌 고정값): TypeScript, pnpm, npm 배포(`npx` 실행), React 계열 코드베이스 대상. Extractor 구현 순서는 미리 정하지 않고 데모 레포에서 감지된 방식부터 만든다.

- [x] 도구 이름 확정: `dsmith`
- [ ] 데모용 공개 레거시 레포 선정
- [ ] 벤치마크 프롬프트 수와 사용 에이전트
- [ ] `install --desktop` 옵션과 `.mcpb` 패키징 포함 여부
