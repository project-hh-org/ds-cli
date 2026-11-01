# Plan 3 설계: AI 표면(install · MCP · 슬래시)과 DS 초안(init · ai)

- 날짜: 2026-11-01
- 상태: 승인 (Plan 2.5 배포 파이프라인 뒤 실행)
- 상위 문서: `2026-10-31-ds-cli-design.md` §2 커맨드, §5 MCP, §6 에이전트 레이어, §7 실행 방식
- 두 단계로 나눠 각각 독립 출시한다: **3a AI 표면**(install + mcp-server + agent-skill), **3b DS 초안**(init + ai). 3a는 상태 0·1·2 어디서나 audit 인덱스만으로 동작해야 하고, 3b가 만든 카탈로그가 있으면 더 정확해진다.

## 1. 3a — AI 표면

### 1.1 `dsmith install`

| 항목 | 결정 |
| --- | --- |
| 역할 | 사용 중인 AI 도구를 감지해 슬래시 명령 파일과 MCP 서버 등록을 **레포 안에** 내려쓴다. 내용은 레포마다 같다(이 레포의 DS 내용은 `ai`가 씀) |
| 도구 감지 | 레포: `.claude/`·`CLAUDE.md` → claude-code, `.cursor/` → cursor, `.gemini/` → gemini, `.agents/`·`AGENTS.md` → codex. 사용자 홈: `~/.claude/` → claude-code, `~/.codex/` → codex, `~/.cursor/` → cursor, `~/.gemini/` → gemini. 아무것도 없으면 claude-code + agents-md 기본. `--tool <name>` 으로 강제, `--all` 로 전부 |
| 한 소스 | `packages/agent-skill/commands/<cmd>.md`: frontmatter `{name, description, args?, uses: ["cli:audit", "mcp:explain_decision"]}` + 본문(도구 중립 마크다운). 렌더러가 도구별 파일로 변환 |
| 렌더러 (파일 하나씩) | `claude-code` → `.claude/skills/ds-<cmd>/SKILL.md` + `.mcp.json` 의 `mcpServers.dsmith`; `codex` → `.agents/skills/ds-<cmd>/SKILL.md` + `AGENTS.md` 섹션 (MCP는 `~/.codex/config.toml` — `--global`에서만 수정, 아니면 안내 출력); `cursor` → `.cursor/commands/ds-<cmd>.md` + `.cursor/mcp.json`; `gemini` → `.gemini/commands/ds-<cmd>.toml` + `.gemini/settings.json` 의 `mcpServers`; `agents-md` → `AGENTS.md` 에 `<!-- dsmith:start -->…<!-- dsmith:end -->` 섹션 (명령 목록 + "슬래시 없으면 `npx dsmith <cmd> --json` 실행 후 설명") |
| 각 도구의 현재 파일 규약 | **구현 시점에 공식 문서를 조회해 확인**하고 `packages/agent-skill/renderers/<tool>.ts` 상단 주석에 확인 날짜·URL을 적는다. 규약이 바뀌면 렌더러 하나만 고친다 |
| MCP 등록 내용 | `{ "command": "npx", "args": ["-y", "dsmith@<major>", "mcp"] }` — 배포 전 로컬 개발에서는 `--mcp-command <path>`로 덮어씀. 기존 항목이 있으면 `dsmith` 키만 갱신 |
| 멱등성 | 모든 산출물은 마커 또는 전용 디렉터리 안에만 쓴다. 두 번 실행해도 diff 없음. 사용자가 수정한 파일은 `--force` 없이는 덮어쓰지 않고 `.dsmith/install.json`에 해시를 기록해 비교 |
| `--global` | claude-code `~/.claude/skills/ds-*/`, codex `~/.codex/config.toml` MCP, cursor/gemini는 레포 전용(글로벌 미지원 시 안내). 레포 파일은 쓰지 않음 |
| `--dry-run` | 쓸 파일 목록과 diff 출력 |
| 산출 | stdout에 "등록한 도구·파일 수·다음 단계(`/ds` 로 시작)" |

### 1.2 슬래시 명령 (얇게)

`commands/*.md` 는 8개: `ds`, `ds-detect`, `ds-audit`, `ds-decide`, `ds-check`, `ds-init`, `ds-ai`, `ds-migrate`(Plan 4 전까지는 "아직 없음" 안내). 본문 규칙:

- CLI를 `--json`으로 실행하고 결과를 **읽어서 설명**한다. 숫자는 지어내지 않는다 — JSON에 없는 숫자는 말하지 않는다.
- 판단이 필요하면 MCP 도구를 부른다 (`ds-decide` → `explain_decision`, `ds-check` → `lint_snippet`).
- `/ds` 는 `detect.state` 에 따라 순서를 고른다: 0 → audit → decide → init → ai, 1 → audit → decide → (migrate), 2 → check/usage. 각 단계 끝에 사람에게 확인을 받는다.
- 길이 상한: 명령당 40줄. 로직은 CLI/Core에 있고 명령은 호출·설명·확인만.

### 1.3 `dsmith mcp` — MCP 서버 (`packages/mcp-server`, CLI 서브커맨드로 노출)

| 항목 | 결정 |
| --- | --- |
| 전송 | stdio. `@modelcontextprotocol/sdk` 의 서버 API(구현 시점 최신 안정판, zod 스키마) |
| 데이터 | `.dsmith/detect.json`, `.dsmith/index.json`(없으면 서버 시작 시 `audit`과 같은 인덱싱을 1회 수행하고 저장), 있으면 `.dsmith/catalog.json`(3b), `.dsmith/decisions.json` |
| 도구 6개 | 아래 표. 응답은 compact JSON, 도구별 토큰 상한(기본 1,500 토큰 ≈ 6KB)을 넘으면 `truncated: true` + 이어 받을 커서 |
| 리소스 | `tokens://list`, `components://list` — 이름 목록만. 본문은 도구로 |
| 상태별 동작 | 카탈로그 없음(상태 0·1): 컴포넌트 도구는 인덱스의 `ComponentUsage` 집계(이름·모듈·props 합집합·사용 수)로 답하고 `source: "index"` 표기. 토큰 도구는 DS 토큰 파일이 있으면 그걸, 없으면 audit 클러스터 대표값(제안 이름)을 쓰고 `source: "proposal"` 표기 |

| Tool | 입력 | 출력 | 엔진 |
| --- | --- | --- | --- |
| `resolve_token` | `{ raw: string, property?: string }` | `{ token?: {name, value}, distance, confidence: high/medium/low, source, alternatives[≤3] }` | core `match` (oklch 거리) + 토큰 소스 |
| `lint_snippet` | `{ code: string, filename?: string }` | `{ violations: [{line, column, property, raw, suggestion?: token, extractor}], summary: {hardcoded, token, dynamic} }` | 스니펫을 가상 파일로 Extractor 전부에 통과 → hardcoded만 위반, `resolve_token`으로 제안 |
| `search_component` | `{ intent: string, limit?: number }` | `[{name, module, score, why, usageCount}]` | 이름 토큰·props 이름·동의어표(date→DatePicker/Calendar, select→Select/Dropdown/Combobox, modal→Modal/Dialog/Sheet …) 점수 |
| `get_component` | `{ name: string, module?: string }` | `{ name, module, props: [{name, type?, required?, values?}], variants?, deprecated?, examples?: [≤1], usage: {count, files[≤5]}, source }` | 카탈로그 있으면 그것, 없으면 인덱스 집계 + 정의 파일의 TS 타입에서 props 추출 |
| `explain_decision` | `{ item: string }` (중복 이름 또는 지역 재정의 이름) | 결정 카드 (아래) | 인덱스 역추적 + 매처 + git log |
| `list_decisions` | `{ status?: pending/decided }` | `[{item, kind: duplicate/local-definition/token-cluster, options[], decided?}]` | `.dsmith/decisions.json` ⟷ 인덱스 |

결정 카드 필드(§6 결정 카드를 데이터로): `item`, `kind`, `options: [{id, label, module|file, usageCount, files[≤5], props[], styleValues: {color[], spacing[]}}]`, `differences: [{aspect, byOption}]`, `impact: {byOption: {callSites, files}}`, `ruleCheck: {tokenMatchRate byOption, a11yNotes?}`, `history: {byOption: {firstCommit, lastCommit, authorsCount}}` (git 없으면 생략), `recommendation: {optionId, reason, confidence}`. 추천 규칙(초기): DS 모듈에서 온 옵션 > 사용 수 많은 옵션 > 토큰 일치율 높은 옵션; 동률이면 `confidence: low`.

`record_decision` 은 쓰기 도구라 MCP에 두지 않는다 — `/ds-decide` 가 사람의 선택을 받아 `npx dsmith decide --item X --choose <id>` (CLI 서브커맨드, `.dsmith/decisions.json` 기록)로 남긴다.

### 1.4 검증

- 단위: 각 도구를 SDK의 인메모리 클라이언트로 호출하는 테스트 (`with-ds-app`: resolve_token이 로컬 토큰 파일 변수로 답함, `legacy-demo`: `source: "proposal"`; lint_snippet이 Tailwind·inline·styled 스니펫 각각에서 위반을 냄; explain_decision("Button") on with-ds-app이 옵션 2개·추천 1개)
- install: 임시 디렉터리에 도구 흔적을 심고 실행 → 산출 파일 스냅샷, 2회 실행 diff 없음, `--dry-run` 무변경, 사용자 수정 파일 보존
- 토큰 상한: 1,000개 컴포넌트 인덱스에서 `search_component` 응답이 상한 이하

## 2. 3b — DS 초안

### 2.1 `dsmith init` (상태 0 진입점)

| 항목 | 결정 |
| --- | --- |
| 입력 | 최신 audit 인덱스 + `.dsmith/decisions.json`(있으면 선택 반영) |
| 토큰 초안 | 색: 클러스터 대표값 → 이름은 리포트의 제안 이름(`gray-50` 등) 규칙 그대로, 충돌 시 `-2` 접미. 간격: 관측된 4px 배수 중 사용 수 상위 → `space-1…n`(4px 단위 인덱스), 벗어난 값은 가장 가까운 스케일로 매핑 표 출력. 글꼴 크기: **font-size 클러스터**(core에 추가; px 반올림 1px 허용) → `text-xs…`. 모서리: border-radius 상위 → `radius-sm/md/lg/full`. 각 토큰에 `usageCount`와 `members`(병합된 원값) 보존 |
| 출력 형식 | `design-system/tokens.json` (**W3C Design Tokens 형식** `{ "color": { "gray-50": { "$value": "#ffffff", "$type": "color", "$extensions": { "dsmith": { "usageCount", "members" } } } } }`), `design-system/tokens.css` (`:root { --color-gray-50: … }`), `design-system/tokens.ts` (`as const` 객체). 경로는 `--out <dir>` (기본 `design-system/`) |
| 컴포넌트 스캐폴드 | 지역 재정의 상위 + 중복 이름에서 **결정된 항목만**(decisions.json에 `decided`) 또는 `--all` 로 상위 N(기본 10). 각 `design-system/components/<Name>.tsx`: props = 사용처 props 합집합(타입은 정의 파일에서 읽을 수 있으면 반영, 없으면 `unknown` 주석) + `// TODO` 와 원 사용처 상위 3개 주석. 기존 파일은 덮어쓰지 않음 |
| 결정 입력 | 없으면 `init`이 먼저 `.dsmith/decisions.json`에 pending 항목을 채우고(중복 128 → 사용 수 상위 20, 지역 재정의 상위 20), "결정 N건이 남아 있음 — `/ds-decide`" 안내. `--all`이면 추천안으로 진행 |
| 멱등성 | 토큰 파일은 재생성(덮어씀, 사람이 수정했으면 `--force` 필요 — `.dsmith/init.json` 해시), 스캐폴드는 새 파일만 |
| 리포트 | `.dsmith/reports/init-<date>.md`: 만든 토큰 수·병합된 원값 수·커버리지(하드코딩 사용 중 토큰으로 대체 가능한 비율 = migrate 예상치) |

### 2.2 `dsmith ai` (상태 1·2, 또는 init 직후)

| 항목 | 결정 |
| --- | --- |
| 역할 | 이 레포의 DS에서 **컴포넌트 카탈로그**를 빌드하고 `AGENTS.md` DS 섹션을 생성·갱신. MCP는 카탈로그가 있으면 그걸 우선 읽음 |
| DS 소스 | `detect.ds`: `local` → 디렉터리의 export된 대문자 컴포넌트, `npm` → `node_modules/<pkg>`의 타입 선언(`types`/`exports` 의 `.d.ts`; 배럴 `export *` 1단계 추적), `none` → `init` 산출(`design-system/`)이 있으면 그것, 없으면 안내 후 종료 |
| 카탈로그 항목 | `{ name, module, file?, props: [{name, type, required, values?(유니온 리터럴), description?(JSDoc)}], deprecated?: string(JSDoc @deprecated), examples?: [stories 파일에서 첫 export의 소스 ≤ 20줄], tokensUsed?: [정의 파일의 token 사용] }`. 타입 추출은 babel(typescript·dts)로 `TSInterfaceDeclaration`/`TSTypeLiteral`/`TSTypeAliasDeclaration` 멤버를 읽는다(제네릭·교차 타입은 이름만 남기고 `type: "…"`); TS 컴파일러 API는 쓰지 않는다(의존성·속도) |
| 토큰 | `detect.ds.tokenFiles`(CSS 변수) + `design-system/tokens.json` → `catalog.tokens` |
| `AGENTS.md` 섹션 | 마커 사이에: DS 위치, 토큰 파일, 컴포넌트 수와 상위 20 이름, 규칙 5줄(하드코딩 금지·토큰 사용·컴포넌트 우선·`/ds-check`), MCP 도구 이름. 길이 상한 80줄 |
| 산출 | `.dsmith/catalog.json`, `AGENTS.md` 섹션, stdout 요약(컴포넌트 N, props 추출 성공률, deprecated M) |

### 2.3 검증

- `with-ds-app`(local DS): `ai` → 카탈로그에 `Button`·`Badge`, props 추출, MCP `get_component("Button")`이 `source: "catalog"`로 props 반환
- `mui-app`(npm DS @mui/material): `.d.ts`에서 `Button` props 상위 N 추출(전부가 아니어도 됨 — `variant`, `size`, `color` 가 values와 함께 나오면 통과)
- `legacy-demo`(상태 0): `init --all` → tokens.json 색 토큰 수가 리포트 색 클러스터 수와 같음, tokens.css 유효 CSS, 스캐폴드 N개, init 리포트 커버리지 수치; 이어서 `ai` → 카탈로그가 `design-system/` 기준으로 생성; 두 번째 `init` 실행 diff 없음
- 실제 레포(비공개, 컨트롤러): init 토큰 수·커버리지, ai 카탈로그 컴포넌트 수, MCP 응답 크기 — `docs/decisions/`에 익명 기록(사용자 OK 받음)

## 3. 공통 결정

- 패키지: `packages/mcp-server`(`@dsmith-dev/mcp-server`), `packages/agent-skill`(`@dsmith-dev/agent-skill`, commands·renderers·templates), `packages/init`(`@dsmith-dev/init`), `packages/catalog`(`@dsmith-dev/catalog`, `ai`의 빌더). CLI가 전부 의존하고 서브커맨드로 노출: `install`, `mcp`, `decide`, `init`, `ai`. 별도 bin은 두지 않는다(`npx dsmith mcp`)
- 새 Core 모듈: `cluster/font-size`, `tokens/draft`(토큰 초안 모델 + W3C 직렬화), `decisions/`(모델·읽기쓰기), `catalog/`(모델만; 빌더는 패키지)
- `.dsmith/` 추가 파일: `decisions.json`, `catalog.json`, `install.json`, `init.json`
- 쓰기 안전: 레포 파일을 쓰는 커맨드(`install`, `init`, `ai`)는 모두 `--dry-run`, 마커/전용 경로, 사용자 수정 보존 규칙을 공유하는 core `fs/safe-write.ts` 하나를 쓴다
- 버전: 3a 머지 후 0.2.0, 3b 머지 후 0.3.0 (changeset minor)
- 범위 밖(Plan 4): migrate·guard·render-diff·usage·benchmark, `record` 외 MCP 쓰기 도구, Figma 소스, `.mcpb` 패키징

## 4. 증명 포인트 (면접용 한 줄)

- "슬래시 명령 8개·MCP 도구 6개가 전부 같은 Core 함수를 감싼다 — 커맨드 하나 추가하면 MCP 도구가 따라온다"
- "상태 0 레포에서 `init` 한 번으로 W3C 토큰 파일과 커버리지 X%가 나오고, `ai` 가 그걸 AGENTS.md와 MCP로 AI에게 연결한다"
- "결정 카드: 사람은 분석하지 않고 고르기만 한다 — 근거(사용처·영향·규칙·역사)는 도구가 채운다"
