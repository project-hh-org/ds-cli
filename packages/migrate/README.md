# @dsmith-dev/migrate

`dsmith migrate`의 엔진. 하드코딩된 스타일 값을 디자인 토큰 참조로 바꾸고, 되돌릴 수 있게 기록한다.

- `planMigration` — 파일을 쓰지 않는 계획. 후보는 core `bestReplacement`(= `replaceableToken`)가 고른 토큰이 있는 하드코딩 사용이다.
- `applyMigration` — 파일 단위로 재파싱·재추출 검증 후 해시 비교로 쓰고, `.dsmith/migrations/<id>.json`에 기록한다(소스보다 먼저).
- `revertMigration` — 기록으로 되돌린다. 적용 뒤 사용자가 고친 파일은 건드리지 않는다.

CLI: `dsmith migrate [--apply] [--revert <id>] [--list]`.
