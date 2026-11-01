# @dsmith-dev/migrate

`dsmith migrate`의 엔진. 하드코딩된 스타일 값을 디자인 토큰 참조로 바꾸고, 되돌릴 수 있게 기록한다.

- `planMigration` / `analyzeMigration` — 파일을 쓰지 않는 계획. 후보는 core `bestReplacement`(= `replaceableToken`)가 고른 토큰이 있는 하드코딩 사용이다. 계획은 audit 인덱스가 아니라 디스크를 다시 읽고(`analyzeMigration`은 그 사용도 돌려줘 전/예상 점수를 같은 값으로 계산하게 한다), 인덱스가 낡았으면 `plan.stale`로 알린다.
- 기본 계획은 같은 값(identical)·exact 매칭만 포함한다. close(±2px·색 ΔE 임계 안)는 `plan.close`에 목록만 남기고 `close: true`(CLI `--close`)일 때만 계획한다.
- 건너뛰는 값: 반투명 색(`translucent-color`), 음수·0, SCSS 변수, 다중 값 단축 속성, UTF-8이 아닌 파일(`binary-or-non-utf8`) 등. 사유별 개수는 `plan.skipped`.
- `applyMigration` — 파일 단위로 재파싱·재추출 검증(속성까지 확인) 후 해시 비교로 쓰고, `.dsmith/migrations/<id>.json`에 기록한다(소스보다 먼저). 한 파일의 쓰기 오류는 그 파일만 `write-failed`로 두고 나머지를 계속 적용한다.
- `revertMigration` — 기록으로 되돌린다. 적용 뒤 사용자가 고친 파일은 건드리지 않는다.

CLI: `dsmith migrate [--apply] [--close] [--revert <id>] [--list]`. 종료 코드 1: 적용하지 못한 파일(롤백·계획 뒤 변경·쓰기 실패)이 있거나, `--revert`에서 되돌리지 못한 파일(적용 뒤 수정됨·없음)이 있을 때.
