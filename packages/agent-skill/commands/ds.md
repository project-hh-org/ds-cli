---
name: ds
description: 레포의 디자인 시스템 상태를 감지하고 상태에 맞는 단계(audit, decide, init, ai, check)를 순서대로 안내한다. "DS 시작", "디자인 시스템 어디서부터", "design system 상태" 같은 요청에 쓴다.
args: "[--root <dir>] [--exclude <glob>]"
uses: ["cli:detect"]
---

`npx dsmith detect --json {{args}}`를 실행하고 stdout JSON을 읽는다. stderr의 힌트·경고도 그대로 전한다.

먼저 `state`, `ds`, `activeExtractors`를 한 줄씩 설명하고 사람에게 맞는지 확인한다. 틀리면 `/ds-detect`로 넘어간다.

`state`로 순서를 고른다:
- 0 (DS 없음): `/ds-audit` → `/ds-decide` → `/ds-init` → `/ds-ai`
- 1 (DS는 있으나 도입이 약함): `/ds-audit` → `/ds-decide` → `/ds-migrate`
- 2 (DS 사용 중): `/ds-check`

규칙:
- 각 단계는 해당 `/ds-*` 명령과 같은 절차로 진행한다. 단계가 끝날 때마다 결과를 요약하고 사람에게 다음 단계로 갈지 확인받는다.
- 상태 0에서 `/ds-init`이 끝나면 `/ds-ai`로 이어 가고, 두 단계 다 사람 확인 뒤에만 파일을 쓴다.
- `/ds-migrate` 단계에 닿으면 "아직 제공되지 않음"이라고 말하고 멈춘다.
- 그 명령의 절차를 모르면 사람에게 `/ds-audit`처럼 그 명령을 직접 입력해 달라고 하고 멈춘다.
- JSON에 없는 숫자는 말하지 않는다.
