---
name: ds-migrate
description: 하드코딩 스타일 값을 토큰 참조로, 결정된 중복 컴포넌트를 DS 컴포넌트로 바꾸는 마이그레이션을 계획하고, 사람이 확인하면 새 브랜치에 적용·커밋한다. "토큰으로 일괄 전환", "하드코딩 치환", "migrate" 같은 요청에 쓴다.
args: "[--files <glob> | --category <c>]"
uses: ["cli:migrate"]
---

계획은 파일을 쓰지 않는다. 이 레포에 audit·init 결과가 없으면 먼저 `/ds-audit`, `/ds-init`를 안내한다.

1. `npx dsmith migrate --json {{args}}`를 실행하고 stdout JSON을 읽는다. stderr의 힌트·경고도 그대로 전한다. 토큰이 없다는 오류면 `/ds-init`을 안내하고 멈춘다.
2. 계획을 표로 보여준다. 숫자는 `plan`과 `projected`의 값만 쓴다:
   - 치환: `planned`, 파일 수 `files`, 카테고리별 `byCategory`
   - 건너뜀: 사유별 `skipped`와 `skippedItems`. 사유는 풀어서 말한다 (`translucent-color`는 반투명 색, `multi-value`는 값이 여러 개인 단축 속성, `no-token-ref` 등)
   - `close`: `--close`를 주지 않으면 치환하지 않고 건수만 알린다. 렌더링되는 값이 바뀔 수 있어 따로 보여주고, 포함할지 사람에게 묻는다
   - 컴포넌트 `components`: 결정된 것만 치환한다. `componentHeld`에 `mapping-missing`이나 `동적 값`이 있으면 `/ds-decide`로 `--map`을 채우라고 안내한다. `decision-pending`은 `/ds-decide`로 먼저 고르게 한다
   - 예상 점수 `projected.before`·`projected.after`
   - `notes`: Tailwind 프리셋이 연결되지 않았다는 안내가 있으면 그대로 전한다
3. `plan.stale`이 있으면 audit 뒤에 파일이 바뀐 것이니 `npx dsmith audit`를 다시 하라고 알린다.
4. 사람이 확인하면 1단계와 같은 인자로 `npx dsmith migrate --apply --branch ds/migrate-<날짜>`를 실행한다. close를 포함하기로 했으면 `--close`도 붙인다. 확인 전에는 `--apply`를 쓰지 않는다.
5. 결과를 전한다: 브랜치와 커밋, 리포트 경로, 마이그레이션 id. 되돌리기는 `npx dsmith migrate --revert <id>`다. PR은 dsmith가 열지 않으니 사람이 직접 연다고 말한다.

`--branch` 결과는 셋 중 하나다:
- 커밋됨: 브랜치와 커밋 해시를 전한다.
- 커밋 없이 남음(일부 파일 실패): 브랜치에 변경이 남아 있다. 출력의 되돌리기 명령을 그대로 전한다.
- 브랜치를 버림: 적용된 것이 없다는 뜻이다.

종료 코드가 1이면 되돌려진 파일, 계획 뒤 바뀐 파일이 있거나 일부만 되돌려진 것이다. 해당 파일과 이유를 `applied`에서 읽어 전한다.

규칙:
- JSON에 없는 숫자는 말하지 않는다. 백분율 변환 외의 계산을 하지 않는다.
- `--branch`는 git 2.23 이상, git 작성자 정보, 커밋되지 않은 변경이 없는 대상 파일, 아직 없는 브랜치 이름이 필요하다. 오류가 나면 이유를 그대로 전한다.
- push하거나 PR을 열지 않는다.
- 적용 뒤 점수는 `actual`을 말한다.
