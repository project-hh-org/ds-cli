# dsmith-benchmarks (비공개)

같은 UI 생성 프롬프트 12개를 같은 에이전트에 두 조건으로 돌려, 만들어진 파일을 제품과 같은 규칙 엔진(`@dsmith-dev/core`의 `evaluateFile`)으로 채점한다.

- `baseline`: dsmith 연결 없음(`.dsmith/`·AGENTS.md DS 섹션·MCP·슬래시 명령 없음)
- `dsmith`: `install` + `ai` 완료 상태

이 패키지는 `private: true`이며 npm에 배포하지 않는다. 이름에 `@dsmith-dev/` 스코프를 쓰지 않아 changeset `fixed` 글롭에도 걸리지 않는다.

## 격리 (중요)

`benchmarks/`는 **에이전트가 보는 복사본에 들어가면 안 된다.** 채점 코드·프롬프트 정답 기준이 에이전트에 노출되면 결과가 오염된다. 실행기(Task 2)는 `examples/legacy-demo`·`fixtures/with-ds-app` 원본만 `os.tmpdir()` 아래(모노레포 밖)로 복사하며, 복사본에 `benchmarks/`가 없다는 것을 강제한다.

## 구성

- `prompts/*.md` — frontmatter(`id`, `file`) + 본문. 모두 `이 레포 스타일로 `로 시작한다.
- `src/score.ts` — 순수 채점 함수(파일시스템·프로세스 없음). 새로 생긴 사용·finding만 센다(추가 파일은 전부, 수정 파일은 base 대비 다중집합 차 — `guard --ci`와 같은 방식).
  - 토큰 준수율 = `token / (token + hardcoded)` (rated 사용, tailwind-default·dynamic 제외)
  - 토큰 사용률 = `token / (token + hardcoded + tailwindDefault)`
  - `knownToken`: 베이스의 토큰 이름·프리셋 키를 실제로 가리키는 token 사용
  - `nonDs`(prefer-ds-component), `deprecated`, `dsComponentUses`, `parseFailed`
