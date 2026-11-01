---
name: ds-decide
description: 중복 컴포넌트·지역 재정의 중 무엇을 표준으로 삼을지 결정 카드로 비교하고, 사람이 고른 결과를 기록한다. "중복 컴포넌트 정리", "어느 Button을 쓸지", "결정 기록" 같은 요청에 쓴다.
uses: ["cli:decide --list", "mcp:list_decisions", "mcp:explain_decision"]
---

미결정 항목을 하나씩 사람과 함께 정한다. 이 레포에 audit 결과가 없으면 먼저 `/ds-audit`를 안내한다.

1. MCP 도구 `list_decisions {status:"pending"}` 로 미결정 항목을 받는다.
2. 항목마다 `explain_decision {item}` 으로 결정 카드를 받아 표로 보여준다: 옵션별 사용 수, 영향(`impact`), 토큰 일치율(`ruleCheck`), 이력(`history`, 없으면 생략), 추천(`recommendation`과 `confidence`).
3. 사람이 옵션을 고른다. 추천은 참고만 하고 대신 고르지 않는다.
4. 고른 뒤 `npx dsmith decide --item "<item>" --choose "<id>"`를 실행해 기록한다.
   카드 `differences`에 props 차이가 있으면 사람에게 대응을 묻고 `--map <from>:<to>`를 함께 넘긴다(값까지 바뀌면 `prop=value:prop=value`). `--map`은 여러 번 줄 수 있고, 다시 기록하면 mapping 전체가 바뀐다(생략하면 기존 것 유지). 대응을 모르면 비워 둔다 — migrate가 그 사용을 보류한다.
5. 다음 항목으로 넘어간다. 항목이 없으면 끝났다고 알린다.

MCP 도구가 없으면(서버 미등록) 이렇게 대신한다:
- 목록: `npx dsmith decide --list --status pending --json`
- 카드: `npx dsmith decide --explain "<item>" --json`
- 그래도 안 되면 `npx dsmith install` 후 AI 도구를 재시작하라고 안내한다.

카드 필드 읽는 법:
- `impact.byOption[x]`는 x를 고르면 바꿔야 하는 다른 옵션의 호출 수(`callSites`)와 파일 수(`files`)다. x의 사용량이 아니다.
- 사용량은 옵션의 `usageCount`다. 영향이 작은 옵션이 "바꿀 것이 적다"는 뜻이다.
- `ruleCheck.tokenUsageRate[x]`는 x의 정의 파일에서 평가 대상 스타일 중 이미 토큰을 쓰는 비율이다.
- `null`은 평가 대상 스타일이 없다는 뜻이다. 0%로 읽지 않는다.

규칙:
- JSON에 없는 숫자는 말하지 않는다.
- `confidence`가 `low`면 근거가 약하다고 먼저 말한다.
- 기록은 사람이 고른 뒤에만 한다.
- `truncated`가 true면 `nextCursor`를 `cursor`로 넘겨 이어 받는다. 개수는 `total`만 말한다. `omitted`가 있으면 잘린 항목이 있다고 알린다.
