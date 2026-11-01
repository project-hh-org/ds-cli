---
name: ds-init
description: audit 결과로 디자인 시스템 초안(W3C 토큰 파일·CSS 변수·TS 상수, 컴포넌트 골격)을 레포에 만들고 커버리지를 보고한다. "DS 초안", "디자인 시스템 만들어줘", "토큰 파일 만들어줘", "init" 같은 요청에 쓴다.
args: "[--root <dir>] [--out <dir>] [--all] [--top <n>] [--force]"
uses: ["cli:init --dry-run", "mcp:list_decisions"]
---

레포에 DS 초안을 만든다. 이 레포에 audit 결과가 없으면 먼저 `/ds-audit`를 안내한다.

1. `npx dsmith init --dry-run --json {{args}}`를 실행하고 stdout JSON을 읽는다. 아직 아무 파일도 쓰지 않는다. stderr의 힌트·경고도 그대로 전한다.
2. 이 순서로 설명한다:
   - 토큰 `tokens`: 색·간격·모서리·글꼴 크기 개수, `total`, 병합된 원값 수 `mergedValues`
   - 커버리지 `coverage.rate`(백분율), `coverage.replaceable`, `coverage.total`. "migrate가 바꿀 수 있는 예상치"라고만 말한다
   - 컴포넌트 골격 `scaffolds`, 건너뛴 것과 이유 `skippedScaffolds`
   - 알파가 빠지는 색 `alphaDropped`가 있으면 개수
   - 결정 대기 `decisions.pending`
3. `decisions.pending`이 0보다 크고 실행 인자에 `--all`이 없으면 `list_decisions {status:"pending"}`로 항목 이름을 보여주고 사람에게 묻는다: `/ds-decide`로 먼저 고르기, 또는 `--all`로 추천안 사용. 사람이 고르기 전에는 쓰지 않는다.
4. 사람이 확인하면 1단계와 같은 인자로 `--dry-run` 없이 `npx dsmith init --json`을 실행한다.
5. `outcomes`를 설명한다:
   - `created`·`updated`·`unchanged`는 그대로 전한다
   - `skipped-modified`는 사람이 고친 토큰 파일이다. `--force`로 덮어쓸지 묻고, 답 없이 `--force`를 붙이지 않는다
   - `skipped-exists`는 "기존 스캐폴드 유지"라고 설명한다. 스캐폴드는 `--force`로도 덮어쓰지 않는다
6. 리포트 경로 `report`를 알리고 다음 단계로 `/ds-ai`를 제안한다.

규칙:
- JSON에 없는 숫자는 말하지 않는다. 백분율 변환 외의 계산을 하지 않는다.
- 쓴 파일은 `outcomes`에 있는 것만 말한다.
- `decisions.stale`이 있으면 선택지가 바뀐 결정이니 `/ds-decide`로 다시 고르라고 알린다.
