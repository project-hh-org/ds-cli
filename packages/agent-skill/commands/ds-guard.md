---
name: ds-guard
description: 하드코딩 스타일이 다시 늘지 않게 ESLint 규칙과 PR 검사(guard --ci) 설정을 레포에 만든다. "하드코딩 막아줘", "린트 규칙 추가", "PR에서 DS 검사", "guard" 같은 요청에 쓴다.
args: "[--ci github]"
uses: ["cli:guard init"]
---

`.dsmith/guard.json` 스냅샷과 ESLint 설정을 만든다. 이 레포에 토큰이 없으면 먼저 `/ds-init`을 안내하고 멈춘다.

1. `npx dsmith guard init --dry-run --json {{args}}`를 실행하고 stdout JSON을 읽는다. 아직 아무 파일도 쓰지 않는다. stderr의 힌트·경고도 그대로 전한다.
2. 쓸 파일과 상태를 보여준다:
   - 스냅샷 `snapshot`, 토큰·DS 컴포넌트 수 `counts`
   - 워크플로 `workflow`(`--ci github`일 때만 있다), `outcomes`의 파일별 결과
   - ESLint 상태 `eslint`: `insert`는 설정에 블록을 끼워 넣는다. 그 밖의 상태는 아래대로 말한다
     - `legacy`(eslintrc): 지원하지 않는다. flat config(`eslint.config.*`)로 옮긴 뒤 다시 한다
     - `unsupported-shape`: 설정 모양을 몰라 고치지 않는다. `snippet`을 보여주고 직접 붙이게 한다
     - `needs-ts-parser`: TS 파일이 있는데 TS 파서가 설정에 없다. 설정은 건드리지 않는다. 안내와 `snippet`을 전한다
     - `not-eslint`·`no-config`: ESLint 설정이 없다. `guard --ci`는 그대로 쓸 수 있다고 말한다
3. 사람이 확인하면 1단계와 같은 인자에서 `--dry-run`을 빼고 `npx dsmith guard init --json`을 실행한다.
4. `notes`를 그대로 전한다. 빠뜨리지 않을 것:
   - `.dsmith/guard.json`을 커밋해야 CI와 ESLint가 같은 기준을 쓴다
   - `@dsmith-dev/eslint-plugin`을 설치한다
   - ESLint 규칙은 JS/TS만 검사한다. CSS·SCSS는 `guard --ci`가 검사한다
   - `eslint --cache`를 쓰면 `guard.json`을 바꾼 뒤 첫 실행은 캐시 없이 돌린다
5. PR 검사는 `npx dsmith guard --ci --base <기준 브랜치>`다. 신규 하드코딩이 있으면 종료 코드 1이다. 코멘트는 `--comment`로 달며 실패해도 종료 코드는 그대로다.

규칙:
- JSON에 없는 숫자는 말하지 않는다.
- 쓴 파일은 `outcomes`에 있는 것만 말한다. 사람이 고친 블록은 `--force` 없이 덮어쓰지 않으니, 답 없이 `--force`를 붙이지 않는다.
- 깨진 `guard.json`이면 init이 멈춘다. 파일 이름을 알리고 `--force`로 다시 만들지 묻는다.
- 오류가 나면 이유를 그대로 전한다.
