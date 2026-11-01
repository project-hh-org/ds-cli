---
name: ds-check
description: 파일의 하드코딩 스타일 값을 찾아 디자인 토큰으로 바꿀 수정안을 제안한다. "토큰으로 바꿔줘", "하드코딩 검사", "이 파일 DS 규칙 맞는지" 같은 요청에 쓴다.
args: "[파일 경로 ...]"
uses: ["mcp:lint_snippet", "mcp:resolve_token"]
---

검사할 파일을 정한다: `{{args}}` 가 있으면 그 파일, 없으면 `git diff --name-only` 중 스타일 코드가 있는 파일(.tsx .jsx .ts .js .css .scss).

파일마다:
1. 내용을 MCP 도구 `lint_snippet {code, filename}` 에 넘긴다.
2. `violations`를 줄·속성·원값 순으로 보여준다. `summary`의 hardcoded, token, dynamic 개수도 전한다.
3. 위반마다 `suggestion`(제안 토큰)이 있으면 수정안을 낸다. 없으면 `resolve_token {raw, property}` 로 가까운 토큰을 찾는다.
4. 수정안을 보여주고 사람이 확인한 뒤에만 파일에 적용한다.

MCP 도구가 없으면(서버 미등록) 도구를 쓸 수 없다고 말하고 "`npx dsmith install` 후 AI 도구를 재시작"하라고 안내한다. 추측으로 토큰을 고르지 않는다.

규칙:
- `confidence`가 `low`인 제안은 후보로만 보여주고 자동 적용하지 않는다.
- `distance`와 개수는 도구 결과의 값만 말한다. 직접 계산하지 않는다.
- 토큰 이름은 도구가 돌려준 것만 쓴다.
