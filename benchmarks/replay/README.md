합성 산출물 — 실측 아님. 채점 파이프라인 테스트용이며 README 숫자에 쓰지 않는다.

`legacy-demo/<조건>/<프롬프트 id>/<반복>/{files/…, run.json}` — 손으로 쓴 `01-form`·`06-badge`·`12-pagination` 세 프롬프트의 baseline·dsmith 산출물이다.
`pnpm --filter dsmith-benchmarks bench:replay`가 이 디렉터리를 채점한다(네트워크·에이전트 없음). 실행기가 `--agent`로 기록하는 배치와 같은 모양이다.

- baseline: Tailwind 기본 클래스 위주, 임의값 하드코딩(`py-[3px]`, `bg-[#3b82f6]`), `01-form`에서 레거시 `@/components/Button` import
- dsmith: `var(--color-…)`·`p-[var(--space-…)]` 토큰, `@/components/ui/button` import, `12-pagination`에 지어낸 `var(--color-brand)` 1개(`knownToken`과 `token`의 차이를 보이려고)
- `run.json`은 `{ "status": "replay" }`만 — 비용·시간 없음
