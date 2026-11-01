# @dsmith-dev/migrate

`dsmith migrate`의 엔진. 하드코딩된 스타일 값을 디자인 토큰 참조로 바꾸고, 되돌릴 수 있게 기록한다.

- `planMigration` / `analyzeMigration` — 파일을 쓰지 않는 계획. 후보는 core `bestReplacement`(= `replaceableToken`)가 고른 토큰이 있는 하드코딩 사용이다. 계획은 audit 인덱스가 아니라 디스크를 다시 읽고(`analyzeMigration`은 그 사용도 돌려줘 전/예상 점수를 같은 값으로 계산하게 한다), 인덱스가 낡았으면 `plan.stale`로 알린다.
- 기본 계획은 같은 값(identical)·exact 매칭만 포함한다. close(±2px·색 ΔE 임계 안)는 `plan.close`에 목록만 남기고 `close: true`(CLI `--close`)일 때만 계획한다.
- 건너뛰는 값: 반투명 색(`translucent-color`), 음수·0, SCSS 변수, 다중 값 단축 속성, UTF-8이 아닌 파일(`binary-or-non-utf8`) 등. 사유별 개수는 `plan.skipped`.
- `applyMigration` — 파일 단위로 재파싱·재추출 검증(속성까지 확인) 후 해시 비교로 쓰고, `.dsmith/migrations/<id>.json`에 기록한다(소스보다 먼저). 한 파일의 쓰기 오류는 그 파일만 `write-failed`로 두고 나머지를 계속 적용한다.
- `revertMigration` — 기록으로 되돌린다. 적용 뒤 사용자가 고친 파일은 건드리지 않는다.

- 결정(`decide`)된 중복 컴포넌트는 import를 DS 쪽으로 바꾼다. props 대응(`mapping`)이 없거나 값이 동적이면 그 사용은 보류(`mapping-missing`)하고, 지역 정의는 지우지 않고 주석만 단다.
- `checkBranch` / `createBranch` / `commitFiles` / `abandonBranch` — `--branch`용 git 단계. git 2.23 이상, 작성자 정보, 깨끗하고 무시되지 않는 대상 파일, 커밋된 토큰·프리셋 파일(아니면 `tokenFiles`·`withTokens` 옵션으로 함께 커밋), 없는 브랜치 이름이 사전 조건이다. push하거나 PR을 열지 않는다.

`plan.tokens.loaded`는 init의 `tokens.css`를 어딘가에서 import하는지 알린다. 아니면 `notes`와 리포트에 안내가 나온다(적용은 막지 않는다).

CLI: `dsmith migrate [--apply] [--branch <name> [--with-tokens]] [--close] [--revert <id>] [--list]`. 종료 코드 1: 적용하지 못한 파일(롤백·계획 뒤 변경·쓰기 실패)이 있거나, `--revert`에서 되돌리지 못한 파일(적용 뒤 수정됨·없음)이 있을 때. `--branch`의 결과는 커밋됨 / 일부 실패로 커밋 없이 남음(되돌리기 명령 출력) / 적용된 것이 없어 브랜치를 버림 중 하나다.

알려진 한계: Tailwind v4에서 `tokens.css`의 `--color-*`·`--radius-*`·`--text-*`가 Tailwind 기본 테마 변수와 같은 이름이면 기본 유틸리티의 값이 바뀔 수 있다. 다루지 않는다.

Docs: https://github.com/project-hh-org/dsmith#readme
