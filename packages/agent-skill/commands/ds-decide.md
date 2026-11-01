---
name: ds-decide
description: 중복 컴포넌트·지역 재정의 중 무엇을 표준으로 삼을지 결정 카드로 비교하고, 사람이 고른 결과를 기록한다. "중복 컴포넌트 정리", "어느 Button을 쓸지", "결정 기록" 같은 요청에 쓴다.
uses: ["cli:decide --list", "mcp:list_decisions", "mcp:explain_decision"]
---

미결정 항목을 하나씩 사람과 함께 정한다. 이 레포에 audit 결과가 없으면 먼저 `/ds-audit`를 안내한다.

1. MCP 도구 `list_decisions {status:"pending"}` 로 미결정 항목을 받는다.
2. 항목마다 `explain_decision {item}` 으로 결정 카드를 받아 표로 보여준다: 옵션별 사용 수, 영향(`impact`), 토큰 일치율(`ruleCheck`), 이력(`history`, 없으면 생략), 추천(`recommendation`과 `confidence`).
3. 사람이 옵션을 고른다. 추천은 참고만 하고 대신 고르지 않는다.
4. 고른 뒤 `npx dsmith decide --item <item> --choose <id>` 를 실행해 기록한다.
5. 다음 항목으로 넘어간다. 항목이 없으면 끝났다고 알린다.

MCP 도구가 없으면(서버 미등록) 이렇게 대신한다:
- 목록: `npx dsmith decide --list --json`
- 카드: `npx dsmith decide --explain <item> --json`
- 그래도 안 되면 `npx dsmith install` 후 AI 도구를 재시작하라고 안내한다.

규칙:
- JSON에 없는 숫자는 말하지 않는다.
- `confidence`가 `low`면 근거가 약하다고 먼저 말한다.
- 기록은 사람이 고른 뒤에만 한다.
