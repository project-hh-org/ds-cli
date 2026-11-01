---
name: ds-audit
description: 이 레포의 하드코딩 스타일 값·중복 컴포넌트를 진단하고 결과를 설명한다. "DS 진단", "하드코딩 얼마나", "design system audit" 같은 요청에 쓴다.
args: "[--root <dir>] [--exclude <glob>]"
uses: ["cli:audit"]
---

`npx dsmith audit --json {{args}}`를 실행하고 stdout JSON을 읽는다. stderr의 힌트·경고도 그대로 전한다.

이 순서로 설명한다:
1. 건강 점수 `health.score`, 산식 `health.formula`, 평가한 값 수 `health.rated`
2. 하드코딩 비율 `health.hardcodedShare`, DS import 비율 `health.dsImportShare` (백분율로)
3. 색 클러스터 `hardcoded.colors` 상위 5개 — `suggestedName`, 대표값, 병합된 원값 수, `total`
4. 간격 `hardcoded.spacing` 중 `onScale: false` 상위 5개
5. 중복 `duplicates[].names`, 지역 재정의 `localDefinitions` 상위 5개
6. 하드코딩이 많은 파일 `hardcoded.byFile` 상위 5개
7. 리포트 파일 — stderr의 `리포트: <경로>` 줄에서 읽은 경로

규칙:
- JSON에 없는 숫자는 말하지 않는다. 백분율 변환 외의 계산을 하지 않는다.
- `health.rated`가 0이면 점수는 참고용이라고 먼저 말한다.
- 끝에 다음 단계 하나만 제안한다: 중복이나 지역 재정의가 있으면 `/ds-decide`, 없고 `detect.state`가 0이면 `/ds-init`, 그 외는 `/ds-check`.
