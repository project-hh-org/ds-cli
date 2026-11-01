---
name: ds-migrate
description: 하드코딩 스타일 값을 토큰 참조로, 결정된 중복 컴포넌트를 DS 컴포넌트로 바꾸는 마이그레이션을 계획하고, 사람이 확인하면 새 브랜치에 적용·커밋한다. "토큰으로 일괄 전환", "하드코딩 치환", "migrate" 같은 요청에 쓴다.
args: "[--files <glob> | --category <c>]"
uses: ["cli:migrate"]
---

계획은 파일을 쓰지 않는다. 이 레포에 audit·init 결과가 없으면 먼저 `/ds-audit`, `/ds-init`를 안내한다.

1. `npx dsmith migrate --json {{args}}`를 실행하고 stdout JSON을 읽는다. stderr의 힌트·경고도 그대로 전한다. 토큰이 없다는 오류면 `/ds-init`을 안내하고 멈춘다.
2. 계획을 표로 보여준다. 숫자는 `plan`과 `projected`의 값만 쓴다:
   - 치환: `plan.planned`, 파일 수 `plan.files.length`, 카테고리별 `plan.byCategory`
   - 건너뜀: 사유별 `plan.skipped`와 `plan.skippedItems`. 사유는 풀어서 말한다 (`translucent-color`는 반투명 색, `multi-value`는 값이 여러 개인 단축 속성, `no-token-ref` 등)
   - `plan.close`: `--close`를 주지 않으면 치환하지 않고 건수만 알린다. 렌더링되는 값이 바뀔 수 있어 따로 보여주고, 포함할지 사람에게 묻는다
   - 컴포넌트 `plan.components`: 결정된 것만 치환한다. 바꾸지 않은 것은 `plan.componentHeld`의 `reason`으로 푼다:
     - `decision-pending`: 결정이 안 끝남. `/ds-decide`로 먼저 고르게 한다
     - `mapping-missing`: 대상에 없는 prop(또는 허용하지 않는 값). `/ds-decide`로 `--map`을 채우라고 안내한다
     - `mapping-conflict`: 이름을 바꾸면 같은 요소에 같은 속성이 둘이 됨. `--map`을 고쳐야 한다
     - `non-jsx-use`: `<Name.Sub>`·`styled(Name)`·`as={Name}`·값 전달처럼 JSX 태그가 아닌 곳에서 써서 prop 대응을 확인할 수 없음. 그 파일은 사람이 손으로 바꾼다
     - `spread-props`: `{...props}` 스프레드가 있어 prop 대응을 확인할 수 없음
     - `export-unknown`: 대상의 내보내기 방식(named·default)을 알 수 없음
     - `overlap`: 토큰 치환과 소스 구간이 겹침
     - `rolled-back`: 치환 뒤 재검증(재파싱·컴포넌트 재추출)에 실패해 그 파일은 변경하지 않음
   - 예상 점수 `projected.before`·`projected.after`. 토큰 치환과 계획된 컴포넌트 import 편집을 모두 반영한 값이다
   - `plan.tokens.loaded.css`가 `false`면 `plan.notes`의 "토큰 스타일시트가 로드되지 않음" 안내를 그대로 전한다. init이 쓴 `tokens.css`를 아무도 import하지 않아 치환된 `var()`가 값을 갖지 못한다. 전역 엔트리(예: `app/layout.tsx`)에 import를 더하라고 권한다. 적용을 막는 조건은 아니다
   - `plan.notes`의 나머지: Tailwind 프리셋이 연결되지 않았다는 안내가 있으면 그대로 전한다
3. `plan.stale.changed > 0 || plan.stale.added > 0`이면(배열 길이) audit 뒤에 파일이 바뀐 것이니 `npx dsmith audit`를 다시 하라고 알린다.
4. 사람이 확인하면 1단계와 같은 인자로 `npx dsmith migrate --apply --branch ds/migrate-<날짜>`를 실행한다. close를 포함하기로 했으면 `--close`도 붙인다. 토큰·프리셋 파일이 아직 커밋되지 않았다는 오류가 나면 먼저 커밋하게 하거나, 사람이 원하면 `--with-tokens`로 같은 커밋에 넣는다. 확인 전에는 `--apply`를 쓰지 않는다.
5. 결과를 전한다: 브랜치와 커밋, 리포트 경로, 마이그레이션 id. 되돌리기는 `npx dsmith migrate --revert <id>`다. PR은 dsmith가 열지 않으니 사람이 직접 연다고 말한다.

`--branch` 결과는 셋 중 하나다:
- 커밋됨: 브랜치와 커밋 해시를 전한다.
- 커밋 없이 남음(일부 파일 실패): 브랜치에 변경이 남아 있다. 출력의 되돌리기 명령을 그대로 전한다.
- 브랜치를 버림: 적용된 것이 없다는 뜻이다.

종료 코드가 1이면 되돌려진 파일, 계획 뒤 바뀐 파일이 있거나 일부만 되돌려진 것이다. 해당 파일과 이유를 `applied`에서 읽어 전한다.

규칙:
- JSON에 없는 숫자는 말하지 않는다. 백분율 변환 외의 계산을 하지 않는다.
- `--branch`는 git 2.23 이상, git 작성자 정보, 커밋되지 않은 변경이 없는 대상 파일, 커밋된 토큰·프리셋 파일, 아직 없는 브랜치 이름이 필요하다. 오류가 나면 이유를 그대로 전한다.
- push하거나 PR을 열지 않는다.
- 적용 뒤 점수는 `actual`을 말한다.
