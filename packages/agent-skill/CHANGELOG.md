# @dsmith-dev/agent-skill

## 0.2.0

### Minor Changes

- [`2d716ee`](https://github.com/project-hh-org/dsmith/commit/2d716ee7c08e8f17e58509652041bb36499b48f5) Thanks [@dahee90522](https://github.com/dahee90522)! - AI 표면 추가: `dsmith install`(AI 도구 감지 → 슬래시 명령 8개와 MCP 서버 등록을 레포에 내려쓰기, `--dry-run`·`--force`·`--global`, 사용자가 고친 파일 보존), `dsmith mcp`(stdio MCP 서버), `dsmith decide`(중복·지역 재정의 컴포넌트 결정 카드와 기록). MCP 도구 6개: `resolve_token`, `lint_snippet`, `search_component`, `get_component`, `explain_decision`, `list_decisions`.

- [`f067062`](https://github.com/project-hh-org/dsmith/commit/f0670624f77e27da3e6947fb92b2f2b09d9f87be) Thanks [@dahee90522](https://github.com/dahee90522)! - DS 초안: `dsmith init`(W3C 토큰 초안·스캐폴드·커버리지), `dsmith ai`(컴포넌트 카탈로그·AGENTS.md DS 섹션), MCP가 카탈로그를 우선 사용.

- [`fe33b86`](https://github.com/project-hh-org/dsmith/commit/fe33b8669a0e11ca5275e507f4a683e78901219c) Thanks [@dahee90522](https://github.com/dahee90522)! - 적용·방어: `dsmith migrate`(토큰·결정 기반 컴포넌트 치환, 되돌리기, 브랜치 커밋), `dsmith guard`(ESLint 플러그인·PR 드리프트 검사), 규칙 엔진 공유.

### Patch Changes

- Updated dependencies [[`2d716ee`](https://github.com/project-hh-org/dsmith/commit/2d716ee7c08e8f17e58509652041bb36499b48f5), [`f067062`](https://github.com/project-hh-org/dsmith/commit/f0670624f77e27da3e6947fb92b2f2b09d9f87be), [`fe33b86`](https://github.com/project-hh-org/dsmith/commit/fe33b8669a0e11ca5275e507f4a683e78901219c)]:
  - @dsmith-dev/core@0.2.0
