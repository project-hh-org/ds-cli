## dsmith (디자인 시스템 도구)

이 레포의 디자인 시스템 진단·결정·검사를 `dsmith`로 한다. 슬래시 명령이 없으면 오른쪽 열의 명령을 실행하고 JSON 출력을 읽어 설명한다.

| 명령 | 하는 일 | 슬래시 없을 때 |
| --- | --- | --- |
| `/ds` | 레포의 디자인 시스템 상태를 감지하고 상태에 맞는 단계(audit, decide, init, ai, migrate, guard, check)를 순서대로 안내한다 | `npx dsmith detect --json` |
| `/ds-ai` | 이 레포의 디자인 시스템(로컬 디렉터리·npm 패키지·init 산출)에서 컴포넌트 카탈로그를 만들고 AGENTS.md의 DS 섹션을 갱신해 AI 도구가 읽게 한다 | `npx dsmith ai --dry-run --json` |
| `/ds-audit` | 이 레포의 하드코딩 스타일 값·중복 컴포넌트를 진단하고 결과를 설명한다 | `npx dsmith audit --json` |
| `/ds-check` | 파일의 하드코딩 스타일 값을 찾아 디자인 토큰으로 바꿀 수정안을 제안한다 | MCP 서버 필요 |
| `/ds-decide` | 중복 컴포넌트·지역 재정의 중 무엇을 표준으로 삼을지 결정 카드로 비교하고, 사람이 고른 결과를 기록한다 | `npx dsmith decide --list --json` |
| `/ds-detect` | 이 레포의 스타일링 방식, 디자인 시스템, 프레임워크, 시작 상태 감지 결과를 설명한다 | `npx dsmith detect --json` |
| `/ds-guard` | 하드코딩 스타일이 다시 늘지 않게 ESLint 규칙과 PR 검사(guard --ci) 설정을 레포에 만든다 | `npx dsmith guard init --json` |
| `/ds-init` | audit 결과로 디자인 시스템 초안(W3C 토큰 파일·CSS 변수·TS 상수, 컴포넌트 골격)을 레포에 만들고 커버리지를 보고한다 | `npx dsmith init --dry-run --json` |
| `/ds-migrate` | 하드코딩 스타일 값을 토큰 참조로, 결정된 중복 컴포넌트를 DS 컴포넌트로 바꾸는 마이그레이션을 계획하고, 사람이 확인하면 새 브랜치에 적용·커밋한다 | `npx dsmith migrate --json` |

MCP 서버 dsmith(`npx -y dsmith@0.2 mcp`) 도구: resolve_token, lint_snippet, search_component, get_component, explain_decision, list_decisions

규칙:
- 명령 출력 JSON에 없는 숫자는 말하지 않는다.
- 결정은 사람이 고른 뒤 `npx dsmith decide --item "<이름>" --choose "<id>"` 로 기록한다.
- 스타일 값을 하드코딩하기 전에 `resolve_token`으로 토큰을 찾는다.