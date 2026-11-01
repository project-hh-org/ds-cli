# 실제 레포 재측정 기록 — Plan 2 before/after

- 날짜: 2026-11-01
- 대상: 약 1,100 파일 규모의 Next.js(pages 라우터) 어드민, 비공개 사내 레포. MUI + styled-components + 인라인 스타일이 섞여 있고 Tailwind는 보관(archived) 디렉터리에만 남아 있다. 레포·회사 이름은 기록하지 않는다.
- 측정 방법: 같은 복사본에 `main`(MVP, Plan 1 완료 시점) 빌드와 `feat/plugin-boundary-css-in-js`(Plan 2, `0151386`) 빌드로 각각 `dsmith audit --root <copy>`를 실행. 컨테이너(Node 22, 2 vCPU 수준).

## 요약 숫자

| 항목 | before (MVP) | after (Plan 2) |
| --- | ---: | ---: |
| 스캔 파일 | 1,140 | 1,143 (+ `.css` 3) |
| 건너뜀 (NUL 바이트 플레이스홀더) | 137 | 137 |
| 활성 Extractor | tailwind, inline-style | tailwind, inline-style, css, styled, emotion, mui-sx |
| 감지됐지만 분석하지 않은 방식 | styled, emotion | 없음 |
| 스타일 사용 | 6,171 | 35,216 |
| 컴포넌트 사용 | 13,043 | 13,043 |
| 동적 값 | 473 | 3,569 |
| hardcodedShare | 0.949 | 0.907 |
| dsImportShare | 0.391 | 0.391 |
| duplicateCount | 312 | 128 |
| 지역 재정의 컴포넌트 (2파일 이상) | — | 상위 20 보고 (Container 153파일, Title 35, Wrap 35 …) |
| 건강 점수 | 14 | 16 |
| 실행 시간 | 12.4s | 17.6s |

점수가 거의 움직이지 않은 이유: 점수는 비율로 계산하는데, 새로 보이게 된 29,000건이 기존 6,000건과 거의 같은 비율로 하드코딩이었다. 즉 MVP 점수 14는 "운 좋게" 맞았던 것이고, 이제는 근거가 6배 넓어졌다.

## Extractor별 사용 수 (after)

| Extractor | 사용 | hardcoded | token | dynamic | 비고 |
| --- | ---: | ---: | ---: | ---: | --- |
| styled | 21,541 | 19,205 | 0 | 2,336 | 전체의 61%. 템플릿 리터럴 안의 `${props => …}`가 동적 값 대부분 |
| mui-sx | 7,115 | 5,053 | 1,302 | 760 | `p: 2`·`bgcolor: "primary.main"` 류가 token으로 잡힘 — 이 레포에서 유일하게 의미 있는 토큰 사용 |
| inline-style | 5,935 | 5,480 | 0 | 455 | before와 동일 |
| css | 377 | 375 | 2 | 0 | `globals.css` + 보관 디렉터리 |
| tailwind | 236 | 73 | 76 | 18 | 보관 디렉터리의 미리보기 전용 |
| emotion | 12 | 12 | 0 | 0 | `@emotion/*`은 MUI 의존성으로만 존재, 직접 사용은 거의 없음 |

하드코딩 상위 속성: other 13,673 · width 3,084 · font-size 3,018 · padding 1,889 · margin 1,758 · height 1,590 · color 1,336 · background-color 1,180. `other`(display, position, cursor 등)는 점수 계산에서 제외된다.

## 중복 312 → 128이 된 이유 (Task 7)

- `@mui/material/Button`과 `@mui/material`에서 온 `Button`이 한 모듈로 합쳐졌다 (`@mui/material` 4,567 → 4,899건).
- tsconfig `paths`의 `@src/*` 별칭과 상대 경로 import가 같은 모듈로 해석됐다 (`src/components/archived/common` 238 → 387건).
- import 없이 쓰인 이름(4,317건)은 더 이상 "출처가 다른 중복"으로 세지 않고, 파일 안에 선언이 있을 때(4,245건)만 "지역 재정의"로 따로 집계한다.
- 남은 128개는 실제로 출처가 둘 이상인 이름이다. 예: `Button`(MUI vs 사내 공통), `Modal`, `Header`, `Pagination`. 이 목록이 Plan 3 `init`의 "결정 필요" 입력이 된다.

## 관찰

1. **styled-components 템플릿이 이 레포의 본체다.** MVP는 이걸 전혀 못 봤다. Plan 2 이후 색 클러스터 상위가 `#ffffff` 계열 799건, `#dddddd` 계열 207건 등 "회색 체계가 없는" 상태를 수치로 보여준다.
2. **MUI sx 숫자 스케일은 이미 토큰처럼 쓰이고 있다** (1,302건). `prepare`에서 테마 파일을 읽으면 `theme.spacing` 재정의 여부까지 확인할 수 있다 (현재는 8/4 기본값 가정).
3. **지역 재정의가 중복보다 큰 문제다.** `Container`가 153개 파일에서 각각 `styled.div`로 선언돼 있다. 이건 "같은 이름 다른 출처"가 아니라 "공통 컴포넌트가 없어서 매 파일이 만든" 신호라서, Plan 3 추천(공통 레이아웃 컴포넌트 후보)으로 바로 이어진다.
4. **NUL 바이트 파일 137개**는 클라우드 동기화의 온라인 전용 플레이스홀더였다(파일 크기는 정상, 내용 전부 `\0`). 도구 문제는 아니지만 건너뜀 사유를 "NUL 바이트 — 클라우드 플레이스홀더일 수 있음"으로 바꾸면 사용자가 덜 헷갈린다.
5. **`.js` 비중이 높은 레포(1,030/1,277)** 에서도 인덱서는 문제없이 돌았다. 실행 시간 +5초는 styled 템플릿 파싱 비용.

## 도구 한계 (다음 계획 입력)

측정 중 드러난 것과 Plan 2 리뷰에서 미뤄 둔 것을 합쳤다.

- 리포트 "컴포넌트 사용량" 표의 출처 열이 `importedFrom`(처음 본 표기)을 보여줘서 별칭 표기(`@src/…`)와 정규화된 `module`이 어긋나 보인다 → 출처 열을 `module`로.
- styled/emotion 객체 문법의 문자열 값(`padding: "13px 8px"`)은 템플릿 문법과 달리 `classifyDeclaration`을 거치지 않아 unknown으로 남는다.
- MUI `styled()`(`@mui/material/styles`)와 `@mui/system` 객체 스타일은 어떤 Extractor도 세지 않는다. 이 레포에선 `styled-components`가 주력이라 영향이 작았지만, MUI 전용 레포에선 누락이 커진다.
- mui-sx: 커스텀 브레이크포인트 객체(`{ mobile: 1 }`)와 반응형 배열(`p: [1, 2]`)은 토큰으로 세지 않는다. 테마 파일을 읽는 `prepare`가 선행돼야 한다. theme-ui의 `sx`(스케일 인덱스)와는 구분하지 않는다.
- 같은 파일 하나에서만 지역 재정의된 이름이 import된 이름과 겹칠 때는 어느 섹션에도 나오지 않는다 (2파일 이상 조건).
- scss: 공백 없는 연산자(`$a+$b`)는 hardcoded, 쉼표가 든 따옴표 문자열은 쪼개진다.
- 동적 값 3,569건(10%)은 통째로 "모름"이다. `${props => props.theme.x}` 패턴은 토큰 참조일 가능성이 높아서, theme 접근 경로를 token으로 분류하는 규칙이 다음 후보다.
- `width`·`font-size`·`height`가 하드코딩 상위인데 현재 간격 후보 표는 padding/margin/gap 중심이다. 타이포 스케일(font-size 클러스터) 섹션이 필요하다.
