# @dsmith-dev/init

dsmith init: draft design tokens (W3C) and component scaffolds from an audit.

Docs: https://github.com/project-hh-org/dsmith#readme

## 쓰기 규칙

`dsmith init`은 `.dsmith/index.json`(audit 결과)을 읽어 `<out>/`(기본 `design-system/`)에 쓴다.

| 산출 | 모드 | 사용자가 고쳤을 때 |
| --- | --- | --- |
| `tokens.json` · `tokens.css` · `tokens.ts` | managed(재생성) | 한 묶음이다. 셋 중 하나라도 사용자가 고쳤으면 **셋 모두** 보류(`skipped-modified`)하고 `--force`로만 함께 덮어쓴다 |
| `components/<Name>.tsx` | create-only | 이미 있으면 `--force`여도 덮어쓰지 않는다(`skipped-exists`) |

- 스캐폴드를 사용자가 **삭제**했으면(`.dsmith/init.json`에 엔트리가 있는데 파일이 없음) 다시 만들지 않는다. `--force`로 재생성한다.
- `.dsmith/init.json`에는 세 토큰 파일의 해시와 함께 가장 최근 산출 디렉터리(`outDir`)·`updatedAt`이 기록된다. `dsmith ai`가 이를 우선해 init 산출을 찾는다.
- `--dry-run`은 `.dsmith/` 포함 어떤 파일도 쓰지 않고 쓸 파일과 diff만 낸다.
- 결정 시드: audit의 중복·지역 재정의 컴포넌트와, 구성원이 둘 이상인 색 클러스터가 `.dsmith/decisions.json`에 `pending`으로 들어간다. 다시 실행하면 구성원이 바뀐 `pending` token-cluster 기록의 선택지를 갱신하고, `decided` 기록은 건드리지 않는다.

## 옵션

- `--all`: 결정 없이 추천안으로 스캐폴드한다. 대상은 `duplicate` → `local-definition` 후보 순서의 **앞에서 `--top`개**(기본 10). 이미 DS에 있는 컴포넌트와 이름이 겹치는 항목은 건너뛴다.
- `--top <n>`: `--all`과 함께만 쓴다(1 이상의 정수). `--all` 없이 쓰면 오류. `--all`이 없으면 결정이 끝난(decided, stale 아님) 항목만 스캐폴드하고 개수 제한은 없다.
- `--out <dir>`: 레포 안 상대 경로(`..`·절대 경로·`.dsmith`·`node_modules` 불가).
- `--force`: 사용자가 고친 토큰 파일 묶음을 덮어쓰고 삭제된 스캐폴드를 다시 만든다. 기존 스캐폴드는 덮어쓰지 않는다.

## 종료 코드

- `0`: 실행 성공. 사용자가 고친 토큰 파일 때문에 일부를 보류한 경우에도 0이며 요약에 `--force` 안내가 나온다.
- `1`: 오류(audit 결과 없음, `--out`·`--top` 검증 실패 등). 메시지는 stderr의 `오류: …`.

## 커버리지 숫자

리포트의 커버리지는 색·간격·모서리·글꼴 크기 속성의 하드코딩 값 중 토큰으로 바꿀 수 있는 비율이다. 정규화하지 못한 값(`unknown`)과 토큰 대상이 아닌 길이(`width`·`height`)는 분모에서 빠지며 그 건수가 리포트에 나온다. 투명도(알파)가 있는 색은 6자리 hex 토큰으로 합쳐지므로 알파가 빠지고, 그 색과 건수를 리포트에 따로 적는다.
