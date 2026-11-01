---
name: ds-ai
description: 이 레포의 디자인 시스템(로컬 디렉터리·npm 패키지·init 산출)에서 컴포넌트 카탈로그를 만들고 AGENTS.md의 DS 섹션을 갱신해 AI 도구가 읽게 한다. "AI용 DS 규칙", "컴포넌트 카탈로그", "에이전트 규칙 파일" 같은 요청에 쓴다.
args: "[--root <dir>] [--from <auto|ds|init>] [--force]"
uses: ["cli:ai --dry-run"]
---

DS를 카탈로그(`.dsmith/catalog.json`)와 AGENTS.md DS 섹션으로 내려쓴다. 이 레포에 audit 결과가 없으면 먼저 `/ds-audit`를 안내한다.

1. `npx dsmith ai --dry-run --json {{args}}`를 실행하고 stdout JSON을 읽는다. 아직 아무 파일도 쓰지 않는다. stderr의 힌트·경고도 그대로 전한다.
2. 이 순서로 설명한다:
   - DS 위치 `sources`: `origin`(ds-local, ds-npm, init)과 `dir` 또는 `packageName`
   - 컴포넌트 수 `components`, props를 읽은 수 `propsExtracted`(`ok`/`total`, `rate`는 백분율)
   - 폐기 예정 `deprecated`, 토큰 수 `tokens`
   - 주의 `warnings`와 알림 `notes`는 고쳐 말하지 않고 그대로 전한다
3. DS를 찾지 못했다는 오류면 `/ds-init`로 초안을 먼저 만들거나 `--from init`을 안내하고 멈춘다.
4. 사람이 확인하면 1단계와 같은 인자로 `--dry-run` 없이 `npx dsmith ai --json`을 실행한다.
5. `outcomes`의 AGENTS.md DS 섹션 결과를 설명한다. `skipped-modified`는 사람이 고친 섹션이다. `--force`로 덮어쓸지 묻고, 답 없이 붙이지 않는다.
6. `notes`에 MCP 서버가 등록되지 않았다는 내용이 있으면 `npx dsmith install`을 제안한다. 등록 뒤에는 AI 도구가 `get_component`로 카탈로그를 먼저 읽는다.

규칙:
- JSON에 없는 숫자는 말하지 않는다. 백분율 변환 외의 계산을 하지 않는다.
- CLAUDE.md는 고치지 않는다. 필요한 한 줄은 `notes` 그대로 사람에게 안내만 한다.
- npm 패키지 DS는 `node_modules`가 설치돼 있어야 읽힌다고 `warnings`가 말하면 그대로 전한다.
