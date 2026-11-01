---
name: ds-detect
description: 이 레포의 스타일링 방식, 디자인 시스템, 프레임워크, 시작 상태 감지 결과를 설명한다. "DS 감지", "스타일링 뭐 쓰는지", "detect 결과가 이상해" 같은 요청에 쓴다.
args: "[--root <dir>] [--exclude <glob>]"
uses: ["cli:detect"]
---

`npx dsmith detect --json {{args}}` 를 실행하고 stdout JSON을 읽는다. stderr의 힌트·경고도 그대로 전한다.

이 5항목을 한 줄씩 설명한다:
1. 스타일링 `styling.methods` — 방식 이름과 비율
2. 디자인 시스템 `ds` — `kind`(npm / local / none)와 패키지 이름·디렉터리
3. 프레임워크 `framework`
4. 시작 상태 `state` — 0 DS 없음, 1 도입이 약함, 2 사용 중. `provisional`이 true면 파일 스캔으로 추정한 값이라고 말한다.
5. 활성 Extractor `activeExtractors`

결과가 틀리면 `.dsmith/detect.json`의 `overrides`로 고칠 수 있다고 알리고, 예시를 보여준다:

```json
{ "overrides": { "state": 1, "activeExtractors": ["tailwind", "css"], "exclude": ["legacy/**"] } }
```

파일을 직접 고치기 전에 사람에게 확인받는다. 고친 뒤에는 `npx dsmith detect --json`을 다시 실행해 반영됐는지 확인한다.

JSON에 없는 숫자는 말하지 않는다.
