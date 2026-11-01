# Plan 4b: 벤치마크와 증명 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 같은 UI 생성 프롬프트 12개를 같은 에이전트에 두 조건(`baseline` = dsmith 연결 없음 / `dsmith` = `install` + `ai` 완료)으로 돌리고, 생성된 파일을 제품과 **같은 규칙 엔진**(`core` `evaluateFile`)으로 채점해 "토큰 준수율 X% → Y%, DS 외 컴포넌트 n → m"을 숫자로 남긴다. 하네스는 외부 에이전트 명령(`--agent "claude -p …"`)을 받거나, 미리 받은 산출물을 채점만 한다(`--replay <dir>` — CI의 결정적 경로). 이 컨테이너에서는 `claude -p`(2.1.316)가 실제로 돌아가므로 컨트롤러가 legacy-demo 12 × 2를 1회 실측하고 결과(json·md·산출물)를 커밋한다. 덧붙여 비공개 실제 레포 전 구간 기록(익명 문서)과 legacy-demo 쇼케이스 브랜치(실제 커밋)를 남긴다.

**Architecture:** 새 비공개 워크스페이스 패키지 `benchmarks/`(이름 `dsmith-benchmarks`, `private: true`, 배포 안 함). 채점은 순수 함수 `score.ts` — guard `--ci`의 `findingsOf`와 같은 조합(`extractFileStyles` → `extractComponentUsage` → `evaluateFile` → `eligibleFindings`)에 사용 소스별 집계(token·hardcoded·tailwind-default·dynamic)를 더한다. 기준(토큰·DS 컴포넌트·정책)은 `@dsmith-dev/guard`의 `buildGuardSnapshot`으로 **조건과 무관한 공통 베이스**에서 한 번 만든다. 실행기 `run.ts`는 레포를 임시 디렉터리(모노레포 밖)에 복사해 베이스(`audit` → `init --all`)를 만들고, 조건별 템플릿(`baseline`: `.dsmith/` 제거 / `dsmith`: `install --tool <t> --mcp-command "node <cli>"` → `ai`)을 거쳐 실행마다 새 복사본 + git 기준 커밋 → 에이전트 실행(프롬프트는 stdin, 정리된 환경 변수, timeout) → `git status`로 바뀐 파일 수집 → 채점. 산출물은 replay와 같은 배치로 기록해 나중에 `--replay`로 같은 숫자를 다시 낸다. `report.ts`가 결과 JSON을 마크다운 표와 README 한 줄로 바꾼다. 제품 패키지 코드는 바꾸지 않는다(필요한 것은 이미 export됨 — 부록 D.6).

**Tech Stack:** 기존(TS 5.7 NodeNext, pnpm, vitest, node 22) + 새 외부 의존성 **없음**(인자 파싱은 `node:util` `parseArgs`, 프로세스는 `node:child_process`). 실측 에이전트는 런타임 바이너리 `claude`(Claude Code 2.1.316, 부록 D.1). `codex`는 이 컨테이너에 없다(`which codex` 실패) — `--agent "codex exec"`는 지원하되 실측하지 않는다.

**Spec:** `docs/superpowers/specs/2026-11-01-migrate-guard-benchmark-design.md` §3(벤치마크·실제 레포 전 구간 기록), §4(공통 결정 — `benchmarks/` 비공개 워크스페이스, 버전), §5(증명 포인트 3번째 문장). 4a 계획 `docs/superpowers/plans/2026-11-01-migrate-guard.md`의 형식·Global Constraints를 계승한다. 4a가 남긴 훅: `evaluateFile`·`eligibleFindings`·`findingKey`·`summarizeFindings`(core), `buildGuardSnapshot`(guard), 4a 최종 리뷰의 "Plan 4b" 항목(벤치마크 하네스, 실제 레포 기록, legacy-demo 쇼케이스 브랜치 — 컨트롤러 단계).

## 결정

| # | 열린 점 | 결정 | 근거 |
| --- | --- | --- | --- |
| 1 | 두 조건의 공통 베이스 | **두 조건 모두 `audit` → `init --all`을 거친 같은 베이스**에서 출발. `baseline`은 베이스에서 `.dsmith/`만 지운 것(AGENTS.md DS 섹션·MCP·슬래시 명령 없음), `dsmith`는 베이스 + `install` + `ai`. legacy-demo에 상태 0 override를 **쓰지 않는다** | 스펙 §3.1 "baseline = install 안 한 복사본", 대상은 "init+ai 완료 상태". 토큰 집합이 두 조건에서 같아야 준수율 비교가 공정하다(`design-system/tokens.*`가 양쪽에 있음). 상태 0 override로 init하면 DS 섹션이 "컴포넌트 0개 · 골격만"이 되어 DS 컴포넌트 지표가 의미를 잃는다(부록 D.4). 자연 감지(상태 1) + `init --all`은 로컬 DS 5개 + 토큰 14개를 함께 준다 |
| 2 | 채점 기준(GuardSnapshot) | 베이스 디렉터리에서 `buildGuardSnapshot({ existing: null })`로 **한 번** 만들어 두 조건 모두에 쓴다. 결과에 스냅샷 sha256·토큰 수를 남긴다 | 조건마다 기준이 다르면 숫자 차이가 기준 차이인지 에이전트 차이인지 구분할 수 없다 |
| 3 | 지표 정의 | 실행(프롬프트×조건×반복)마다 바뀐 파일의 **새로 생긴** 사용·finding만 센다(추가 파일은 전부, 수정 파일은 HEAD 대비 다중집합 차 — guard `--ci`와 같은 방식). **토큰 준수율 = token / (token + hardcoded)**(rated 사용, tailwind-default·dynamic 제외 — `decisions/card.ts`의 tokenShare와 같은 분모). 보조: **토큰 사용률 = token / (token + hardcoded + tailwind-default)**, `knownToken`(베이스 토큰 이름·프리셋 키를 실제로 가리키는 token), `nonDs` = `prefer-ds-component` finding, `dsComponentUses` = DS module에서 온 컴포넌트 사용, `deprecated` | Tailwind 레포에서 baseline 에이전트는 주로 기본 스케일 클래스(`p-4`, `bg-blue-100`)를 쓴다(부록 D.3 — badge 11건, pagination 15건). 이것을 하드코딩으로 세면 baseline이 부당하게 나빠지고, 빼기만 하면 분모가 작아진다 → 둘 다 표에 싣는다. 지어낸 변수(`var(--made-up)`)도 소스는 token이라 `knownToken`으로 따로 센다 |
| 4 | 실측 레포 | **legacy-demo만 실측**(12 × 2 × 1). with-ds-app은 `--repo`로 지원하고 replay 테스트로만 덮는다 | with-ds-app은 5파일·토큰 1개·DS 컴포넌트 1개(부록 D.5) — 준수율 분모가 노이즈. README 한 줄은 legacy-demo 숫자 |
| 5 | 에이전트·모델·상한 | `claude -p --output-format stream-json --verbose --model sonnet --max-turns 20 --max-budget-usd 0.5 --permission-mode acceptEdits --allowedTools mcp__dsmith --setting-sources project --no-session-persistence`(**두 조건 같은 명령**). 모델은 `sonnet`(이 컨테이너에서 `claude-sonnet-5-5`로 해석) | 부록 D.1의 프로브: 실행당 $0.064~$0.078·4~8턴·15~19초 → 24회 ≈ **$1.5~$2.5, 약 8~10분**(순차). 상한 $0.5/회 → 최악 $12(+한 턴 초과분 — 예산은 턴이 끝난 뒤 검사됨). haiku는 더 싸지만 실사용 코딩 모델이 아니라 결과가 대표성이 없다. `--allowedTools mcp__dsmith` 없이는 MCP 호출이 거부된다(D.1.6). `--setting-sources project`는 사용자 수준 스킬(`frontend-design` 등)을 빼 두 조건의 잡음을 줄인다 |
| 6 | 에이전트 환경 변수 | 기본 **정리된 환경**: `HOME`·`PATH`·`LANG`·`LC_ALL`·`TMPDIR`·`ANTHROPIC_API_KEY`·`OPENAI_API_KEY`만 넘기고(있을 때), `--pass-env NAME`으로 추가. `CLAUDE*`·`CLAUDECODE` 계열은 넘기지 않는다 | 부모 환경을 물려받은 `claude -p`는 부모 세션 id를 그대로 썼다(D.1.2). `env -i HOME PATH`로도 인증·실행이 됐다 |
| 7 | 채점 코드 격리 | 복사본은 `os.tmpdir()`의 `mkdtemp`(모노레포 밖, 경로가 모노레포 아래면 Error), 원본은 `examples/legacy-demo`·`fixtures/with-ds-app`뿐(`benchmarks/` 없음). 에이전트 stdout(stream-json — 도구 입력 포함)에 `<monorepo>/benchmarks`가 나오면 그 실행에 `harnessPathSeen: true`를 기록하고 보고서에 경고 | `dsmith` 조건의 `.mcp.json`·스킬은 `node <monorepo>/packages/cli/dist/bin.js`를 가리킨다(로컬 빌드를 쓰기 위해 — npm의 `dsmith@0.1`은 0.1.0으로 낡음, D.4.4). 그 경로 자체는 정상이고, 채점 코드 경로만 감시한다 |
| 8 | 산출물 보존 | `--agent` 실행은 바뀐 파일 전체 내용을 replay와 같은 배치로 `benchmarks/results/<date>-<repo>/outputs/`에 기록(커밋), stream-json 기록은 `…/transcripts/`(gitignore). 커밋된 결과 JSON은 커밋된 outputs를 `--replay`로 다시 채점한 값과 같아야 한다(테스트) | 실측은 재현 불가 — 산출물을 남겨야 채점만은 재현된다 |
| 9 | 합성 replay 세트 | `benchmarks/replay/legacy-demo/`에 손으로 쓴 산출물 3프롬프트 × 2조건(합성임을 README에 명시). `mode: "replay"` 결과로는 README 한 줄을 만들지 않는다(`readmeLine`이 던짐) | CI에서 실행기·채점·보고 전 구간을 네트워크 없이 고정. 합성 숫자가 실측처럼 읽히면 안 된다 |
| 10 | 쇼케이스(§3.2 "커밋으로 남긴다") | **모노레포의 브랜치 체인** `showcase/legacy-demo`(main 기준, `examples/legacy-demo`에 init 산출 커밋) → `migrate --apply --branch showcase/legacy-demo-migrate`가 만든 커밋 → 같은 브랜치에 `guard init` 커밋 → 재유입 커밋. **main에 머지하지 않는다**. main에는 `docs/showcase/legacy-demo.md`(명령·실제 출력·숫자·브랜치/커밋 링크)만 | 중첩 레포는 불가. `migrate --branch`는 `--root`가 git 최상위의 하위 디렉터리여도 동작한다(D.4.6 — 28건, 52→59, 14파일 커밋). main의 legacy-demo는 e2e 스냅샷(점수 52)에 고정이라 바꿀 수 없다. "migrate가 만든 브랜치"를 그대로 보여 주는 실물이 면접 자료로 낫다 |
| 11 | changeset | **4b는 changeset을 추가하지 않는다** | 바뀌는 배포 패키지가 없다(`benchmarks`는 private, README는 npm 패키지 README가 아님). 스펙 §4의 "4b → 그다음 마이너"는 4a 릴리스가 먼저 나간다는 전제인데, npm 최신은 0.1.0이고 `ai-surface`·`ds-draft`·`migrate-guard` changeset이 아직 대기 중(D.6) — 4b minor를 넣어도 같은 0.2.0에 흡수될 뿐이다. 구현 중 배포 패키지를 고쳐야 하면 그 Task에서 `patch` changeset을 더한다 |
| 12 | 반복·통계 | 기본 `--repeat 1`. 보고서는 N·반복·관측 모델·에이전트 버전·날짜·dsmith 커밋·총비용·실패 실행 수·프롬프트별 숫자와 "개선/같음/악화" 개수만 싣고 유의성 검정·신뢰구간은 쓰지 않는다. "해석 한계" 절은 고정 문구 | n=12 단일 실행으로 할 수 있는 말은 "이번 실행에서 이렇게 나왔다"까지다 |
| 13 | 프롬프트 위치 | 12개 모두 `src/components/<Name>.tsx`(두 레포 공통, 기존 파일과 이름 겹치지 않음). 본문 끝에 "다른 파일은 고치지 말고 그 파일 하나만 만드세요. 패키지 설치나 빌드·테스트 실행은 하지 마세요." | 레포 중립, 채점 범위 예측 가능(그래도 바뀐 파일은 전부 센다). 이 문형은 D.1.8에서 그대로 실행 확인 |

## Global Constraints

- 4a Global Constraints를 따른다: ESM only, `tsconfig.base.json` 상속(`strict`·`noUncheckedIndexedAccess`·`exactOptionalPropertyTypes`), 한국어 conventional commit, **Co-Authored-By·Claude-Session 등 트레일러 없음**, author `Dahee Hwang <dahee@project-hh.com>`(`git -c user.name="Dahee Hwang" -c user.email="dahee@project-hh.com" commit …`), **각 커밋에서 루트 `pnpm -r build && pnpm test && pnpm typecheck` 녹색**, 파일 편집은 Edit/Write 도구로만(Python·sed 스크립트로 소스 고치기 금지)
- **원본을 바꾸지 않는다:** `examples/legacy-demo`·`fixtures/*`는 읽기 전용. 하네스·테스트는 `os.tmpdir()` 아래 `mkdtemp` 복사본만 쓰고 끝나면 지운다(`--keep`일 때만 남김). 쇼케이스 브랜치(Task 5)만 예외이며 main에 머지하지 않는다
- **제품 패키지(`packages/*`) 코드 변경 없음**이 기본. 필요한 export가 없으면 멈추고 보고한다(부록 D.6에 쓰는 export 전부 확인됨)
- 기존 e2e 스냅샷(`packages/cli/test/__snapshots__/e2e.test.ts.snap`)·`e2e-migrate-guard.test.ts` 불변
- **채점은 같은 엔진만:** 하드코딩·DS 외·deprecated 판정은 `evaluateFile` + `eligibleFindings` 결과만 쓴다. 벤치마크 쪽에서 규칙을 다시 구현하지 않는다(집계·다중집합 차·`knownToken` 판정만 벤치마크 코드)
- **네트워크 없는 테스트:** vitest는 실제 에이전트를 부르지 않는다(가짜 에이전트 `node <fixture>.mjs`). `claude`가 PATH에 있어도 테스트가 쓰지 않는다
- 결정적 출력: `score.ts`·`report.ts`는 같은 입력에 바이트 같은 출력(정렬: 프롬프트 id → 조건(`baseline`, `dsmith`) → 반복 번호, 파일은 code-unit 순). 시각은 결과 JSON의 `date`·`startedAt`과 실행별 `durationMs`에만
- 숫자를 꾸미지 않는다: README·보고서 문구는 결과 JSON 값만 쓰고, replay 결과로는 README 줄을 만들지 않는다. 실측이 실패하면(인증·한도) "재생 모드로 채점 파이프라인만 검증"이라고 기록한다(스펙 §3.1)
- 비공개 레포: 이름·회사·도메인·파일 경로를 공개 문서·커밋 메시지에 쓰지 않는다(기존 `docs/decisions/2026-11-01-real-repo-coverage.md`와 같은 익명 수준). 컨트롤러 스크래치 경로도 공개 문서에 적지 않는다

## Review Focus

1. **공정성** — 두 조건이 같은 베이스·같은 스냅샷·같은 에이전트 명령·같은 환경 변수로 도는가. 차이는 `.dsmith/` 유무 + `install`·`ai` 산출뿐인가 → Task 2
2. **같은 엔진** — `score.ts`의 하드코딩·DS 외 수가 같은 파일·같은 스냅샷에 대한 guard `--ci`(신규 파일) 결과와 같은가(교차 테스트) → Task 1
3. **수정 파일의 차분** — 에이전트가 기존 파일을 고친 경우 원래 있던 하드코딩을 새로 센 것으로 치지 않는가(다중집합 차) → Task 1
4. **격리** — 복사본이 모노레포 밖인가, `benchmarks/`가 복사본에 없는가, 에이전트 환경에 `CLAUDE*`가 새지 않는가, 타임아웃이 프로세스 그룹을 죽이는가 → Task 2
5. **재현** — 커밋된 결과 JSON = 커밋된 outputs의 replay 채점, 합성 replay가 README 줄을 만들지 못함 → Task 2·3·4
6. **정직한 보고** — 분모(건수)와 tailwind-default가 표에 함께 있는가, 실패·한도 초과·`harnessPathSeen` 실행이 빠지지 않고 표시되는가, 해석 한계 절 → Task 3·4

---

## File Structure

```
benchmarks/                                   새 비공개 패키지 dsmith-benchmarks (배포 안 함)
  package.json, tsconfig.json, README.md
  prompts/01-form.md … 12-pagination.md       프롬프트 12개(frontmatter id·file + 본문)
  src/prompts.ts                              loadPrompts, parsePrompt
  src/extractors.ts                           내장 Extractor 6종 이름표(cli registry와 같은 키)
  src/score.ts                                순수 채점: scoreRun, aggregate, usageKey, isKnownTokenRef
  src/base.ts                                 prepareBase(복사·audit·init·스냅샷), prepareCondition, makeRunCopy
  src/agent.ts                                runAgent(stdin·정리된 env·timeout·프로세스 그룹), parseAgentMeta, agentVersion
  src/collect.ts                              collectChanges(git status/show), writeOutputs, readReplay
  src/run.ts                                  CLI 진입점(parseArgs) + runBench
  src/report.ts                               renderReport(md), readmeLine
  src/model.ts                                BenchResult·RunRecord·RunScore·Aggregate 타입
  replay/legacy-demo/{baseline,dsmith}/<id>/1/{files/…,run.json}   합성 산출물 3프롬프트
  replay/README.md                            "합성 — 실측 아님"
  test/{prompts,score,score-vs-guard,args,agent,collect,replay-e2e,report,results-replay}.test.ts
  test/fixtures/fake-agent.mjs                프롬프트의 경로에 정해진 파일을 쓰는 가짜 에이전트
  results/<date>-legacy-demo.{json,md}, results/<date>-legacy-demo/outputs/…   Task 4(컨트롤러)가 커밋
pnpm-workspace.yaml, vitest.workspace.ts, package.json, tsconfig.json, .gitignore   benchmarks 편입
README.md                                     "벤치마크" 절(Task 3) + 상단 한 줄(Task 4)
docs/decisions/2026-11-01-real-repo-end-to-end.md   Task 5(컨트롤러, 익명)
docs/showcase/legacy-demo.md                  Task 5(컨트롤러)
```

**순서·의존:** T1 → T2 → T3 → T4(컨트롤러 실측) → T5(컨트롤러, T4와 독립 — T3 뒤 아무 때나) → T6(최종 리뷰). T1~T3은 구현자 세션, T4·T5는 컨트롤러가 직접(실제 에이전트 실행·비공개 레포·브랜치 push 판단), T6은 리뷰어.

---

### Task 1: `benchmarks/` 패키지 골격 + 프롬프트 12개 + 순수 채점 `score.ts`

**Files:**
- Create: `benchmarks/{package.json,tsconfig.json,README.md}`, `benchmarks/prompts/*.md`(12), `benchmarks/src/{model,prompts,extractors,score}.ts`
- Modify: `pnpm-workspace.yaml`(`- "benchmarks"` 추가), `vitest.workspace.ts`(`["packages/*", "benchmarks"]`), 루트 `package.json`(`build`·`test`·`typecheck`의 필터에 `--filter ./benchmarks` 추가; `lint`는 그대로), 루트 `tsconfig.json`(`references` 끝, `cli` 뒤에 `{ "path": "benchmarks" }`), `.gitignore`(`benchmarks/results/**/transcripts/`)
- Test: `benchmarks/test/{prompts,score,score-vs-guard}.test.ts`

**Interfaces:**
- Consumes(core): `extractFileStyles`, `extractorMatchers`, `extractComponentUsage`, `parseTsx`, `evaluateFile`, `eligibleFindings`, `findingKey`, `isRatedUsage`, `ruleContextOf`, `moduleContextOf`, 타입 `GuardSnapshot`·`Finding`·`ComponentUsage`; extractor 6종; (테스트만) guard `buildGuardSnapshot`, detect `readDetect`
- `package.json`: `name "dsmith-benchmarks"`, `private: true`, `version "0.0.0"`, `type "module"`, `engines.node ">=20"`, scripts `build "tsc -b"`, `test "vitest run"`, `typecheck "tsc --noEmit -p tsconfig.json"`, `bench "node dist/run.js"`(Task 2부터 의미 있음); dependencies `@dsmith-dev/{core,detect,guard,extractor-api,extractor-css,extractor-emotion,extractor-inline-style,extractor-mui-sx,extractor-styled,extractor-tailwind}` `workspace:*`, devDependencies `dsmith` `workspace:*`(빌드 순서 — Task 2가 `packages/cli/dist/bin.js`를 실행), `vitest ^3.0.0`. **이름에 `@dsmith-dev/` 스코프를 쓰지 않는다**(changeset `fixed` 글롭 `@dsmith-dev/*`에 걸리지 않게)
- `tsconfig.json`: `extends ../tsconfig.base.json`, `rootDir src`, `outDir dist`, `include ["src"]`, references `../packages/{extractor-api,core,detect,guard}` + extractor 6종
- Produces:
  ```ts
  // model.ts
  export type Condition = "baseline" | "dsmith";
  export const CONDITIONS: readonly Condition[] = ["baseline", "dsmith"];
  export interface UsageCounts {
    token: number;            // rated && source "token" (새로 생긴 것)
    knownToken: number;       // token 중 isKnownTokenRef 참
    hardcoded: number;        // no-hardcoded-style finding(eligible) 수 — evaluateFile 기준
    replaceable: number;      // 그중 replacement !== null
    tailwindDefault: number;  // rated && source "tailwind-default"
    dynamic: number;          // source "dynamic"
  }
  export interface FileScore {
    file: string;                         // 복사본 root 상대 POSIX
    status: "added" | "modified";
    parseFailed: boolean;                 // 추출·파싱이 던짐 → 집계에서 뺀다(파일 수에는 셈)
    introduced: UsageCounts;
    nonDs: number;                        // prefer-ds-component finding(새로 생긴 것)
    deprecated: number;                   // no-deprecated-component finding(새로 생긴 것)
    dsComponentUses: number;              // 새로 생긴 컴포넌트 사용 중 module ∈ DS module
    nonDsDetails: { name: string; module: string; preferModule: string }[];
  }
  export interface RunScore {
    files: FileScore[];                   // file 순
    excluded: string[];                   // snapshot.exclude 매칭(예: design-system/**) — 채점 안 함
    ignored: string[];                    // 스크립트·Extractor 대상 아님, 또는 하네스 관리 파일(아래 IGNORED)
    deleted: string[];
    expectedFile: boolean;                // 프롬프트의 file이 added|modified에 있는가
    totals: UsageCounts & { nonDs: number; deprecated: number; dsComponentUses: number; parseFailed: number; files: number };
    compliance: number | null;            // token / (token + hardcoded), 분모 0이면 null, 소수 4자리
    tokenShareAll: number | null;         // token / (token + hardcoded + tailwindDefault)
  }

  // prompts.ts
  export interface Prompt { id: string; file: string; text: string; sha256: string }   // sha256 = text의 sha256Text
  /** `---\nid: <id>\nfile: <path>\n---\n<본문>` — 본문은 앞뒤 공백을 자른 그대로. id는 /^\d{2}-[a-z-]+$/, file은 상대 POSIX이고 본문에 그대로 포함돼야 함. 어긋나면 Error(파일 이름 포함) */
  export function parsePrompt(name: string, text: string): Prompt;
  /** dir의 *.md를 이름 순으로. ids가 있으면 그 id만(없는 id는 Error) */
  export function loadPrompts(dir: string, ids?: string[]): Promise<Prompt[]>;

  // extractors.ts — 키는 cli registry와 같아야 한다(테스트가 6개 이름을 고정)
  export const BUILTIN_EXTRACTORS: Record<string, Extractor>;
  export function extractorsFor(names: string[]): Extractor[];   // 모르는 이름은 Error

  // score.ts (순수 — fs·프로세스 없음)
  export const IGNORED: readonly string[];   // [".claude/**", ".dsmith/**", ".mcp.json", "AGENTS.md", "CLAUDE.md", ".codex/**", ".cursor/**", ".gemini/**", "node_modules/**", ".git/**"]
  export interface FileChange { file: string; status: "added" | "modified" | "deleted"; before: string | null; after: string | null }
  export interface ScoreInput {
    root: string;                         // 베이스 디렉터리(extractFileStyles의 root, prepare를 마친 matchers의 root)
    snapshot: GuardSnapshot;
    matchers: ReturnType<typeof extractorMatchers>;
    changes: FileChange[];
    expectedFile: string;
  }
  export function scoreRun(input: ScoreInput): RunScore;
  /** `${property}|${raw}|${source}` — conformance·guard와 같은 모양 */
  export function usageKey(u: StyleUsage): string;
  /**
   * token 사용이 베이스 기준을 실제로 가리키는가: raw 안의 `var(--x)` 이름이 모두 snapshot.tokens의 name이고 1개 이상이거나,
   * var()가 없고 snapshot.preset?.keys의 값(예 "ds-blue-400") 중 하나로 raw가 `-<key>`로 끝남(Tailwind 변형 접두·`!` 무시).
   */
  export function isKnownTokenRef(u: StyleUsage, snapshot: GuardSnapshot): boolean;
  export function ratio(num: number, den: number): number | null;   // 소수 4자리 반올림
  ```
  `scoreRun` 절차(파일마다, `file` 순):
  1. `deleted` → `deleted`에. `IGNORED`(picomatch, `dot: true`) → `ignored`. `snapshot.exclude` 매칭 → `excluded`. `/\.[cm]?[jt]sx?$/`도 아니고 matchers 어느 것과도 맞지 않으면 → `ignored`
  2. `after`와 `before`(없으면 `""` 취급하지 않고 "사용 없음")에 대해 guard `ci.ts` `findingsOf`와 같은 조합: `extractFileStyles({ root, file, code }, matchers).styles` → 스크립트 파일이면 `extractComponentUsage(file, parseTsx(code, file), snapshot.moduleContext.tsPaths, moduleContextOf(snapshot))` → `eligibleFindings(evaluateFile({ file, usages, components, ...ruleContextOf(snapshot) }))`. `after` 쪽이 던지면 `parseFailed: true`, 나머지 0
  3. finding 차: `findingKey` 다중집합으로 after − before(guard `--ci`의 `newFindings`와 같음) → `hardcoded`·`replaceable`·`nonDs`·`deprecated`·`nonDsDetails`
  4. 사용 차: rated(`isRatedUsage`) 사용의 `usageKey` 다중집합 after − before → 남은 것 중 source별 `token`·`tailwindDefault`; `dynamic`은 rated와 무관하게 source "dynamic" 차; `knownToken`은 남은 token 사용 중 `isKnownTokenRef`
  5. 컴포넌트 차: `${name}|${module}` 다중집합 after − before 중 module이 `snapshot.ds.modules`에 있거나 `snapshot.ds.components`의 `module`/`modules`에 있으면 `dsComponentUses`
  6. `expectedFile` = `expectedFile`이 added|modified 목록에 있음. totals는 parseFailed 아닌 파일 합, `files` = 채점한 파일 수(parseFailed 포함)
- 프롬프트 12개(본문 그대로 — 구현자가 바꾸지 않는다. 모두 `이 레포 스타일로 `로 시작하고 `다른 파일은 고치지 말고 그 파일 하나만 만드세요. 패키지 설치나 빌드·테스트 실행은 하지 마세요.`로 끝난다):

  | 파일 | id | file | 본문 가운데 |
  | --- | --- | --- | --- |
  | `01-form.md` | `01-form` | `src/components/ProductForm.tsx` | 상품명·가격·카테고리 선택·설명 입력란과 저장·취소 버튼이 있는 상품 등록 폼 컴포넌트를 `src/components/ProductForm.tsx` 에 만들어 주세요. |
  | `02-modal.md` | `02-modal` | `src/components/DeleteConfirmModal.tsx` | 제목·설명 문구와 취소·삭제 버튼이 있는 상품 삭제 확인 모달 컴포넌트를 `src/components/DeleteConfirmModal.tsx` 에 만들어 주세요. 열림 상태는 props로 받습니다. |
  | `03-list.md` | `03-list` | `src/components/RecentOrderList.tsx` | 주문번호·고객명·금액·상태를 한 줄씩 보여 주고 항목 사이에 구분선이 있는 최근 주문 목록 컴포넌트를 `src/components/RecentOrderList.tsx` 에 만들어 주세요. |
  | `04-card.md` | `04-card` | `src/components/CustomerSummaryCard.tsx` | 이름·이메일·누적 주문 수·회원 등급을 보여 주는 고객 요약 카드 컴포넌트를 `src/components/CustomerSummaryCard.tsx` 에 만들어 주세요. |
  | `05-table.md` | `05-table` | `src/components/InventoryTable.tsx` | 상품명·SKU·재고 수량·상태 열이 있고 재고가 10개 미만인 행을 강조하는 재고 테이블 컴포넌트를 `src/components/InventoryTable.tsx` 에 만들어 주세요. |
  | `06-badge.md` | `06-badge` | `src/components/StockStatusBadge.tsx` | 재고 상태(충분·부족·품절)를 보여 주는 배지 컴포넌트를 `src/components/StockStatusBadge.tsx` 에 만들어 주세요. |
  | `07-tabs.md` | `07-tabs` | `src/components/OrderStatusTabs.tsx` | 전체·결제완료·배송중·완료 탭이 있고 선택된 탭을 강조하며 onChange로 바뀐 값을 알리는 주문 상태 탭 컴포넌트를 `src/components/OrderStatusTabs.tsx` 에 만들어 주세요. |
  | `08-toast.md` | `08-toast` | `src/components/SaveToast.tsx` | 성공·실패 두 종류와 닫기 버튼이 있는 저장 결과 토스트 컴포넌트를 `src/components/SaveToast.tsx` 에 만들어 주세요. |
  | `09-sidebar.md` | `09-sidebar` | `src/components/FilterSidebar.tsx` | 카테고리 체크박스·가격 범위 입력·초기화 버튼이 있는 상품 목록 필터 사이드바 컴포넌트를 `src/components/FilterSidebar.tsx` 에 만들어 주세요. |
  | `10-settings.md` | `10-settings` | `src/components/NotificationSettingsPage.tsx` | 섹션 제목, 이메일·SMS·푸시 알림 토글 세 개, 저장 버튼이 있는 알림 설정 페이지 컴포넌트를 `src/components/NotificationSettingsPage.tsx` 에 만들어 주세요. |
  | `11-empty.md` | `11-empty` | `src/components/NoSearchResults.tsx` | 아이콘 자리·안내 문구·필터 초기화 버튼이 있는 검색 결과 없음 빈 상태 컴포넌트를 `src/components/NoSearchResults.tsx` 에 만들어 주세요. |
  | `12-pagination.md` | `12-pagination` | `src/components/Pagination.tsx` | 이전·다음 버튼과 페이지 번호가 있고 현재 페이지를 강조하는 페이지네이션 컴포넌트를 `src/components/Pagination.tsx` 에 만들어 주세요. |

  예: `06-badge.md` 본문 = `이 레포 스타일로 재고 상태(충분·부족·품절)를 보여 주는 배지 컴포넌트를 src/components/StockStatusBadge.tsx 에 만들어 주세요. 다른 파일은 고치지 말고 그 파일 하나만 만드세요. 패키지 설치나 빌드·테스트 실행은 하지 마세요.`(본문에서는 경로에 백틱을 쓰지 않는다 — 표의 백틱은 표기용)
- [ ] **Step 1: 실패하는 테스트**
  - prompts: 12개 로드, id 순서 `01-form`…`12-pagination`, 각 본문이 `이 레포 스타일로 `로 시작·고정 꼬리 문장으로 끝·`file`을 포함, `file`이 모두 `src/components/`이고 서로 다름, `examples/legacy-demo`·`fixtures/with-ds-app`에 그 파일이 없음; frontmatter 누락·id 형식 오류·본문에 file 없음 → 각각 Error; `ids: ["06-badge"]` → 1개, 없는 id → Error
  - extractors: 키 집합 = `["css","emotion","inline-style","mui-sx","styled","tailwind"]`
  - score(베이스는 `beforeAll`에서 legacy-demo를 임시로 복사 → `node packages/cli/dist/bin.js audit` → `init --all` → `readDetect` → `buildGuardSnapshot`; 스냅샷 토큰 14·ds.modules 4개를 단언 — 부록 D.4.2):
    - 부록 D.3의 프로브 파일(`bg-[#3b82f6] p-4 bg-[color:var(--color-blue-400)] p-[var(--space-2)] text-[var(--made-up)] bg-ds-blue-400 rounded-lg` + `style={{ color: "#111827", padding: "var(--space-4)", margin: 8 }}` + `import { Button } from "@/components/ui/button"` + `./Card`)를 added로 → `hardcoded 3`, `replaceable 3`, `token 4`(color·padding 둘·bg-ds), `knownToken 4`, `tailwindDefault 2`, `nonDs 0`, `dsComponentUses 1`, `compliance 0.5714`, `tokenShareAll 0.4444`. (`text-[var(--made-up)]`은 property other라 rated가 아님 — 0)
    - 같은 파일에 `var(--made-up-color)` 배경 하나 추가 → token +1, knownToken 그대로
    - 수정 파일: before에 하드코딩 2개, after = before + 하드코딩 1개 + 토큰 1개 → `hardcoded 1`, `token 1`(기존 2개는 새로 센 것이 아님); after에서 기존 하드코딩 하나를 지움 → `hardcoded 0`(음수 없음)
    - `function Button() {}` + `<Button />`을 같은 파일에 → `nonDs 1`(declaredLocally, DS에 Button 있음), `src/components/Button`에서 import → `nonDs 1`(같은 이름 비DS module), `@/components/ui/button` → 0
    - `design-system/tokens.css` 변경 → `excluded`, `AGENTS.md`·`.claude/x.md` → `ignored`, `README.md` → `ignored`, 삭제 → `deleted`; 구문이 깨진 `.tsx`(`<div className="a>`) → `parseFailed true`(던지지 않음 — errorRecovery로 결과가 나오면 parseFailed false이고 그 값 그대로; 어느 쪽인지 테스트로 고정)
    - expectedFile 없음 → false; 같은 입력 두 번 → `JSON.stringify` 동일
  - score-vs-guard(같은 엔진 교차): 임시 git 레포(legacy-demo 복사 → audit → init → guard init → commit "base")에서 프로브 파일을 새 커밋으로 추가 → `runGuardCi({ base: "main" })`의 `counts.newHardcoded`·`newNonDs` = `scoreRun`의 `hardcoded`·`nonDs`(스냅샷은 그 레포의 `.dsmith/guard.json`을 `readGuardSnapshotSync`로)
- [ ] **Step 2: 실패 확인 → 구현 → 통과** — 루트 `pnpm -r build && pnpm test && pnpm typecheck`; `pnpm ls -r --depth -1`에 `dsmith-benchmarks` 보임, `pnpm changeset status`가 benchmarks를 버전 대상으로 잡지 않음
- [ ] **Step 3: Commit** — 두 개: `chore(benchmarks): 비공개 벤치마크 워크스페이스와 UI 생성 프롬프트 12개` / `feat(benchmarks): 같은 규칙 엔진으로 산출물 채점(score) — 새로 생긴 사용만, 토큰 준수율·DS 외 컴포넌트`

---

### Task 2: 실행기 — 베이스·조건 준비, 에이전트 실행, 변경 수집, replay, `run.ts` CLI

**Files:**
- Create: `benchmarks/src/{base,agent,collect,run}.ts`, `benchmarks/test/fixtures/fake-agent.mjs`, `benchmarks/replay/legacy-demo/**`(합성 3프롬프트 × 2조건), `benchmarks/replay/README.md`
- Test: `benchmarks/test/{args,agent,collect,replay-e2e}.test.ts`

**Interfaces:**
- Consumes: Task 1 전부, `node packages/cli/dist/bin.js`(`audit`·`init --all`·`install`·`ai`), core `localDate`·`sha256Text`, guard `buildGuardSnapshot`, detect `readDetect`
- Produces:
  ```ts
  // base.ts
  export const REPOS = { "legacy-demo": "examples/legacy-demo", "with-ds-app": "fixtures/with-ds-app" } as const;
  export type RepoName = keyof typeof REPOS;
  export const MONOREPO_ROOT: string;        // benchmarks/dist 기준 ../..
  export const CLI_BIN: string;              // <MONOREPO_ROOT>/packages/cli/dist/bin.js — 없으면 prepareBase가 "pnpm -r build 먼저" Error
  export interface Base { dir: string; snapshot: GuardSnapshot; snapshotSha256: string; matchers: ReturnType<typeof extractorMatchers> }
  /**
   * mkdtemp(os.tmpdir(), "dsmith-bench-base-") ← REPOS[repo] 복사(.dsmith 제외) → `audit --json` → `init --all --json`
   * (둘 다 node CLI_BIN, cwd=dir, 정리된 env, 실패면 stderr 포함 Error). 상태 override 없음(결정 1).
   * snapshot = buildGuardSnapshot({ root: dir, detect: readDetect(dir), version: "bench", existing: null }), sha = sha256Text(JSON.stringify(snapshot)).
   * extractorsFor(snapshot.extractors)를 prepare(dir) 후 matchers. dir이 MONOREPO_ROOT 아래면 Error.
   */
  export function prepareBase(repo: RepoName): Promise<Base>;
  /**
   * base.dir을 새 mkdtemp로 복사한 조건 템플릿.
   * baseline: .dsmith/ 삭제.
   * dsmith: `install --tool <installTool> --mcp-command "node <CLI_BIN>" --json` → `ai --json`(둘 다 exit 0이어야 함). AGENTS.md에 dsmith DS 마커가 있어야 함.
   */
  export function prepareCondition(base: Base, condition: Condition, installTool: string): Promise<string>;
  /** 템플릿을 새 mkdtemp로 복사 → git init -b main, `-c user.name=dsmith-bench -c user.email=bench@dsmith.invalid -c commit.gpgsign=false` add -A·commit "bench base". 반환 경로 */
  export function makeRunCopy(template: string): Promise<string>;
  /** installTool 기본값: agent 명령 첫 단어가 claude → "claude-code", codex → "codex", 그 밖 → "agents-md" */
  export function defaultInstallTool(agentCmd: string): string;

  // agent.ts
  export const PASS_ENV: readonly string[];   // ["HOME","PATH","LANG","LC_ALL","TMPDIR","ANTHROPIC_API_KEY","OPENAI_API_KEY"]
  /** PASS_ENV ∪ extra 중 process.env에 있는 것만. 이름이 /^CLAUDE|^CLAUDECODE/면 extra로 줘도 Error(결정 6) */
  export function agentEnv(extra: string[], env?: NodeJS.ProcessEnv): Record<string, string>;
  export interface AgentRun { exitCode: number | null; timedOut: boolean; durationMs: number; stdout: string; stderrTail: string }
  /** spawn("sh", ["-c", cmd], { cwd, env, detached: true }); prompt를 stdin에 쓰고 닫음; timeout이면 process.kill(-pid, "SIGKILL"); stdout 최대 32MB(넘으면 자르고 표시), stderr 마지막 4KB */
  export function runAgent(cmd: string, prompt: string, opts: { cwd: string; env: Record<string, string>; timeoutMs: number }): Promise<AgentRun>;
  export interface AgentMeta { costUsd?: number; turns?: number; subtype?: string; models?: string[]; permissionDenials?: number; isError?: boolean }
  /** stdout이 JSON 한 개(`--output-format json`)거나 JSONL(stream-json)일 때 `type: "result"`(또는 `total_cost_usd`가 있는) 마지막 객체에서: total_cost_usd·num_turns·subtype·Object.keys(modelUsage) 정렬·permission_denials.length·is_error. 못 읽으면 null(에이전트 종류 무관) */
  export function parseAgentMeta(stdout: string): AgentMeta | null;
  /** 명령 첫 단어 + " --version"(timeout 10s, 같은 정리된 env). 첫 줄 trim, 실패면 null */
  export function agentVersion(cmd: string, env: Record<string, string>): Promise<string | null>;

  // collect.ts
  /** `git status --porcelain=v1 -z -uall`(cwd=copy) → A/M/D/??(이름 변경은 R → 새 경로 added + 옛 경로 deleted). before = `git show HEAD:<file>`(없으면 null), after = 파일 내용(바이너리·1MB 초과는 ignored로) */
  export function collectChanges(copy: string): Promise<FileChange[]>;
  /** replay 배치: <dir>/<condition>/<promptId>/<rep>/files/<file>(added·modified의 after) + run.json({ status, exitCode, durationMs, agentMeta, harnessPathSeen, deleted }) */
  export function writeOutputs(dir: string, condition: Condition, promptId: string, rep: number, changes: FileChange[], run: Omit<RunRecord, "prompt" | "condition" | "rep" | "score">): Promise<void>;
  /** replay 읽기: files/ 아래 파일 = after. before는 base.dir의 같은 경로(있으면 modified, 없으면 added). run.json 없으면 status "replay", 나머지 null. 프롬프트 디렉터리가 없으면 그 실행은 status "missing" */
  export function readReplay(dir: string, base: Base, condition: Condition, promptId: string, rep: number): Promise<{ changes: FileChange[]; run: Partial<RunRecord> }>;

  // model.ts (추가)
  export interface RunRecord {
    prompt: string; condition: Condition; rep: number;
    status: "ok" | "agent-error" | "timeout" | "replay" | "missing";
    exitCode: number | null; durationMs: number | null;
    agentMeta: AgentMeta | null;
    harnessPathSeen: boolean;
    score: RunScore;
  }
  export interface Aggregate extends UsageCounts {
    runs: number; okRuns: number; failedRuns: number; missingExpected: number; harnessPathSeen: number;
    nonDs: number; deprecated: number; dsComponentUses: number; parseFailed: number; files: number;
    compliance: number | null; tokenShareAll: number | null;
    costUsd: number | null;               // agentMeta.costUsd 합(하나도 없으면 null)
    turns: number | null;
  }
  export interface BenchResult {
    version: 1;
    date: string;                         // YYYY-MM-DD(localDate, --date로 덮어씀)
    startedAt: string | null;             // ISO, replay면 null
    repo: RepoName;
    mode: "agent" | "replay";
    agent: { command: string | null; version: string | null; installTool: string | null; models: string[] };   // models = 모든 실행 agentMeta.models 합집합 정렬
    dsmith: { version: string; commit: string | null };   // packages/cli/package.json version, 모노레포 `git rev-parse HEAD`(실패 null)
    base: { tokens: number; dsComponents: number; snapshotSha256: string };
    prompts: { id: string; file: string; sha256: string }[];
    conditions: Condition[]; repeat: number; timeoutSec: number | null;
    runs: RunRecord[];                    // prompt → condition → rep 순
    aggregate: Partial<Record<Condition, Aggregate>>;
  }
  // score.ts (추가, 순수)
  export function aggregate(runs: RunRecord[]): Aggregate;   // 한 조건의 실행들. totals 합 → 비율 재계산(실행별 비율 평균이 아님)

  // run.ts
  export interface BenchArgs {
    repo: RepoName;
    agent: string | null; replay: string | null;   // 정확히 하나
    conditions: Condition[];                        // 기본 ["baseline","dsmith"]
    repeat: number;                                 // 기본 1, 1..10
    prompts: string[] | null;                       // --prompts 06-badge,12-pagination
    out: string | null;                             // 결과 JSON 경로. md는 같은 이름 .md. 주지 않으면: agent → benchmarks/results/<date>-<repo>.json, replay → 파일을 쓰지 않고 md를 stdout으로
    record: string | null;                          // agent의 산출물 디렉터리. 기본 <out 확장자 뺀 경로>/outputs
    timeoutSec: number;                             // 기본 600
    installTool: string | null; passEnv: string[]; keep: boolean; date: string | null; agentVersion: string | null;
  }
  /** node:util parseArgs. --agent와 --replay 둘 다/둘 다 없음, 모르는 repo·condition, repeat 범위 밖 → Error(사용법 포함) */
  export function parseBenchArgs(argv: string[]): BenchArgs;
  export function runBench(args: BenchArgs, log?: (line: string) => void): Promise<BenchResult>;
  // 진입점: import.meta.url === pathToFileURL(process.argv[1]).href 일 때만 main 실행(테스트 import 안전). 오류는 stderr + exit 2
  ```
  `runBench` 흐름: `prepareBase` → 조건별 `prepareCondition`(replay는 생략) → 프롬프트 × 조건 × 반복 **순차**: agent면 `makeRunCopy` → `runAgent` → `collectChanges` → `harnessPathSeen = stdout.includes(path.join(MONOREPO_ROOT, "benchmarks"))` → transcripts에 stdout 저장(`<record>/../transcripts/<condition>/<id>-<rep>.jsonl`) → `writeOutputs` → `scoreRun` → 복사본 삭제(`--keep`이면 경로 로그). status: timedOut → "timeout", exitCode ≠ 0 → "agent-error"(산출물은 그래도 채점), 그 밖 "ok". replay면 `readReplay` → `scoreRun`. 끝에 `aggregate`(조건별), `BenchResult` 조립, out이 있으면 JSON(2칸 + "\n")과 `renderReport`(Task 3 — Task 2에서는 `report.ts`가 없으므로 JSON만 쓰고 md는 Task 3에서 연결) 기록. 베이스·템플릿 디렉터리는 `finally`에서 삭제
- 합성 replay(`benchmarks/replay/legacy-demo/`, 프롬프트 `06-badge`·`01-form`·`12-pagination`): baseline은 Tailwind 기본 클래스 위주 + 임의값 하드코딩(`py-[3px]`, `bg-[#3b82f6]`) + `01-form`에서 `src/components/Button`(레거시) import; dsmith는 `var(--color-blue-400)`·`p-[var(--space-2)]`·`@/components/ui/button` import + `12-pagination`에 지어낸 `var(--color-brand)` 1개(knownToken 차이를 보이려고). 각 `run.json`은 `{ "status": "replay" }`만. `replay/README.md` 첫 줄: "합성 산출물 — 실측 아님. 채점 파이프라인 테스트용이며 README 숫자에 쓰지 않는다."
- `fake-agent.mjs`: stdin 프롬프트에서 `src/components/\S+\.tsx` 경로를 찾아, 환경 변수 `FAKE_AGENT_MODE`(없으면 cwd에 `AGENTS.md`가 있으면 `dsmith`, 없으면 `baseline`)에 따라 정해진 내용을 쓰고 claude stream-json 모양 결과 줄 `{"type":"result","subtype":"success","num_turns":1,"total_cost_usd":0.001,"modelUsage":{"fake-model":{}},"permission_denials":[]}`를 stdout에 출력. `FAKE_AGENT_SLEEP_MS`가 있으면 그만큼 기다림(timeout 테스트), `FAKE_AGENT_EXIT`이 있으면 그 코드로 종료. **에이전트 env 정리 때문에 FAKE_* 값은 `--pass-env`로 넘긴다**
- [ ] **Step 1: 실패하는 테스트**
  - args: 기본값(conditions 2개, repeat 1, timeout 600); `--agent`·`--replay` 동시 → Error; 둘 다 없음 → Error; `--repo foo` → Error; `--repeat 0`·`11` → Error; `--prompts 06-badge,12-pagination`; `--conditions dsmith`
  - agent: `agentEnv([], { HOME, PATH, CLAUDE_CODE_SESSION_ID: "x", CLAUDECODE: "1", ANTHROPIC_API_KEY: "k" })` → `CLAUDE*` 없음, 키는 있음; `agentEnv(["CLAUDE_X"])` → Error; `runAgent("cat", "안녕")` → stdout "안녕"; `runAgent("sleep 5", …, { timeoutMs: 200 })` → timedOut, 1초 안에 반환, 자식 프로세스 없음(`sh -c "sleep 5 & wait"`로 손자까지 죽는지); `parseAgentMeta` — 부록 D.1.8의 실제 결과 줄 모양(JSON 한 개, JSONL 마지막 줄, 앞에 비JSON 줄 섞임) → cost·turns·models; 아무 텍스트 → null
  - collect: 임시 git 레포에서 추가·수정·삭제·이름 변경·바이너리 → 분류와 before/after
  - replay-e2e(네트워크 없음): `runBench({ repo: "legacy-demo", replay: "benchmarks/replay/legacy-demo", prompts: ["01-form","06-badge","12-pagination"], date: "2026-11-01", out: null })` → runs 6개, status 모두 "replay", baseline aggregate의 `compliance` < dsmith의 `compliance`, dsmith `token − knownToken === 1`, baseline `nonDs ≥ 1`, 두 번 실행해 `JSON.stringify(result)` 동일(startedAt null). 결과 숫자를 인라인 스냅샷으로 고정
  - fake agent e2e: `--agent "node <abs>/fake-agent.mjs" --pass-env FAKE_AGENT_MODE`가 아닌 기본(AGENTS.md 유무로 분기) → baseline 실행 복사본에 AGENTS.md·`.dsmith/` 없음, dsmith 실행 복사본에 AGENTS.md(dsmith 마커)·`.mcp.json`(command `node`, args[0] = CLI_BIN)·`.dsmith/catalog.json` 있음(가짜 에이전트가 cwd 목록을 stdout 한 줄로 내게 해서 단언); `record` 디렉터리에 replay 배치 생성; 그 디렉터리를 `--replay`로 다시 돌린 aggregate = 원래 aggregate(costUsd·durationMs·status 제외); 복사본 경로가 모두 os.tmpdir() 아래이고 MONOREPO_ROOT 아래가 아님; 실행 후 tmp에 `dsmith-bench-` 디렉터리가 남지 않음(`keep: false`); `FAKE_AGENT_EXIT=3` → status "agent-error"이고 산출물은 채점됨; `FAKE_AGENT_SLEEP_MS=5000` + timeoutSec 1 → "timeout"
  - 격리: 가짜 에이전트가 `process.env`에서 `CLAUDE`로 시작하는 키 수를 출력 → 0
- [ ] **Step 2: 실패 확인 → 구현 → 통과** — 루트 세 명령. replay-e2e·fake agent e2e 합쳐 30초 안(베이스 준비 ~2초/회 — 부록 D.4.1)
- [ ] **Step 3: Commit** — 두 개: `feat(benchmarks): 베이스·조건 준비와 에이전트 실행기(정리된 환경·timeout·변경 수집)` / `feat(benchmarks): replay 모드와 합성 산출물, run CLI`

---

### Task 3: 보고서 `report.ts` + README "벤치마크" 절 + 패키지 README

**Files:**
- Create: `benchmarks/src/report.ts`, `benchmarks/test/report.test.ts`
- Modify: `benchmarks/src/run.ts`(out이 있으면 md도 쓰고, replay에 out이 없으면 md를 stdout), `benchmarks/README.md`, `README.md`(새 절 `## 벤치마크` — `## 같은 규칙 엔진` 다음, `## 지원하는 스타일링 방식` 앞), 루트 `package.json`(scripts `"bench": "pnpm --filter dsmith-benchmarks run bench --"`, `"bench:replay": "pnpm --filter dsmith-benchmarks run bench -- --repo legacy-demo --replay replay/legacy-demo"`)
- Test: `benchmarks/test/report.test.ts`

**Interfaces:**
- Produces:
  ```ts
  /** 결정적 마크다운. 숫자는 result 값만 */
  export function renderReport(result: BenchResult): string;
  /**
   * README 상단 한 줄. mode가 "replay"면 Error("replay 결과로는 README 줄을 만들지 않음").
   * 조건 둘이 다 있어야 함. 형식(한 줄, 끝 마침표 없음):
   * 벤치마크(프롬프트 {N}개 × 조건 2, {agentLabel}, {date}): 토큰 준수율 {b}% → {d}%, DS 외 컴포넌트 {nb} → {nd} — benchmarks/results/{date}-{repo}.md
   * agentLabel = agent.command의 첫 두 단어("claude -p"), 백분율은 compliance×100을 소수 첫째 자리까지(null이면 "—")
   */
  export function readmeLine(result: BenchResult, mdPath: string): string;
  ```
  `renderReport` 구성(순서 고정):
  1. `# 벤치마크 결과 — {repo} ({date})`
  2. 조건 표(항목·값): 모드, 프롬프트 수 N, 조건, 반복, 에이전트 명령(코드 블록), 에이전트 버전, 관측 모델, dsmith 버전·커밋, 베이스 토큰 수·DS 컴포넌트 수·스냅샷 sha256 앞 12자, 실행 수(성공·실패·timeout·missing), 총비용(USD, 소수 2자리, 없으면 "—"), `harnessPathSeen` 실행 수(0이 아니면 **경고** 문장)
  3. `## 요약` 표: 행 = 지표(토큰 준수율, 토큰 사용률, token(known), hardcoded(대체 가능), Tailwind 기본 스케일, dynamic, DS 외 컴포넌트, DS 컴포넌트 사용, deprecated, 파싱 실패, 기대 파일 없음), 열 = baseline · dsmith. 비율은 "57.1% (4/7)"처럼 분자/분모를 함께
  4. `## 프롬프트별` 표: id · 파일 · baseline(준수율, token/hardcoded/기본, DS 외) · dsmith(같음) · 판정(준수율 기준 "개선"/"같음"/"악화"/"비교 불가") — 반복 > 1이면 합산값. 표 아래 "개선 a · 같음 b · 악화 c · 비교 불가 d"
  5. `## 해석 한계`(고정 문구): 프롬프트 {N}개·반복 {k}회의 단일 측정이며 에이전트 출력은 비결정적이다 / 유의성 검정을 하지 않았다 / 준수율 분모에서 Tailwind 기본 스케일 클래스는 뺐다(별도 행) / 렌더링·타입 검사는 하지 않았다 — `tokens.css` 로드·프리셋 연결 여부는 측정 밖 / 채점은 dsmith 자신의 규칙 엔진이고 dsmith 조건의 에이전트는 같은 엔진(`lint_snippet`)을 쓸 수 있다 — 같은 기준에 맞추도록 돕는 효과를 잰 것이지 독립 평가가 아니다 / 산출물은 `{record 경로}`에 있고 `pnpm bench -- --repo {repo} --replay <그 경로>`로 같은 채점을 다시 낼 수 있다(replay 모드면 "합성 산출물 — 실측 아님"으로 대체)
- README `## 벤치마크` 절(버전 숫자·결과 숫자 없음 — 결과 숫자는 Task 4가 상단 한 줄로): 무엇을 재는가(두 조건 정의, 같은 베이스·같은 엔진), 실행법(`pnpm -r build` → `pnpm bench -- --repo legacy-demo --agent "<결정 5의 명령>"`, `pnpm bench:replay`), 지표 정의(준수율·사용률·knownToken·DS 외), 격리(임시 복사본, 정리된 env, `harnessPathSeen`), 한계 요약 3줄, `codex exec` 같은 다른 에이전트도 stdin으로 프롬프트를 받는 명령이면 된다는 것(실측은 claude만)
- [ ] **Step 1: 실패하는 테스트** — 고정 `BenchResult`(손으로 만든 2프롬프트) → `renderReport` 스냅샷 1건; 두 번 같은 바이트; replay 결과의 해석 한계 문장이 "합성"; `readmeLine` — agent 결과 → 정확한 문자열 1건(`벤치마크(프롬프트 2개 × 조건 2, claude -p, 2026-11-01): 토큰 준수율 12.5% → 87.5%, DS 외 컴포넌트 3 → 0 — benchmarks/results/2026-11-01-legacy-demo.md`), compliance null → "—", replay → Error, 조건 하나 → Error; `pnpm bench:replay`를 `execFileSync`로 → stdout에 `## 요약` 포함·exit 0·파일 생성 없음(`git status --porcelain benchmarks` 빈 문자열)
- [ ] **Step 2: 실패 확인 → 구현 → 통과** — 루트 세 명령
- [ ] **Step 3: Commit** — `feat(benchmarks): 결과 보고서(md)와 README 한 줄 생성, bench 스크립트·README 벤치마크 절`

---

### Task 4 (컨트롤러 직접): legacy-demo 실측 12 × 2 → 결과 커밋 + README 상단 한 줄

**실행 주체:** 컨트롤러(오케스트레이터). 실제 에이전트 호출·비용 판단이 들어가므로 구현자에게 넘기지 않는다.

**Files:**
- Create: `benchmarks/results/<date>-legacy-demo.json`, `benchmarks/results/<date>-legacy-demo.md`, `benchmarks/results/<date>-legacy-demo/outputs/**`, `benchmarks/test/results-replay.test.ts`
- Modify: `README.md`(상단 — 첫 소개 단락 바로 아래 한 줄)

**Steps:**
- [ ] **Step 1: 사전 확인** — `pnpm -r build` 녹색; `claude --version`(2.1.316 기대 — 다르면 부록 D.1 플래그를 `claude -p --help`로 다시 확인하고 결과 문서에 버전 기록); 스모크 1회: `pnpm bench -- --repo legacy-demo --prompts 06-badge --conditions baseline --agent "<결정 5 명령>" --out /tmp/…/smoke.json` → status ok·비용·턴 기록, 산출물 확인 후 스모크 파일 삭제
- [ ] **Step 2: 실측** — `pnpm bench -- --repo legacy-demo --agent "claude -p --output-format stream-json --verbose --model sonnet --max-turns 20 --max-budget-usd 0.5 --permission-mode acceptEdits --allowedTools mcp__dsmith --setting-sources project --no-session-persistence"` (기본: 12 × 2 × 1, timeout 600s, 순차). Bash `run_in_background`로 돌리고 끝나면 결과 확인. **예상 $1.5~$2.5·8~10분, 중단 기준: 누적 $8 초과 또는 실패 실행 6개 이상** → 멈추고 원인 기록(인증·한도면 스펙 §3.1대로 "재생 모드로 채점 파이프라인만 검증"을 결과 문서에 남기고 README 줄은 쓰지 않는다)
- [ ] **Step 3: 결과 점검(눈으로)** — 실행 24개 status, `harnessPathSeen` 0, 각 조건에서 산출물 3개씩 열어 채점과 맞는지(하드코딩·token 건수 손으로 세기), transcripts에서 dsmith 조건의 MCP 호출(`mcp__dsmith__*`) 횟수와 `permission_denials` 요약을 결과 md의 "관찰" 절에 짧게 추가(이 절만 손으로 씀 — 숫자는 transcripts에서 센 값). 결과가 dsmith에 불리해도 그대로 둔다
- [ ] **Step 4: 재현 테스트** — `results-replay.test.ts`: `benchmarks/results/*.json` 중 `mode: "agent"`인 파일마다 같은 이름 디렉터리의 `outputs`를 `--replay`로 채점한 `aggregate`(costUsd·turns·status 관련 필드 제외)·실행별 `score`가 커밋된 값과 같다. 결과 파일이 없으면 `it.skip`
- [ ] **Step 5: README 한 줄** — `readmeLine(result, "benchmarks/results/<date>-legacy-demo.md")` 출력을 README 상단(소개 단락 다음 줄)에 Edit로 넣는다. 숫자를 다듬지 않는다
- [ ] **Step 6: Commit** — 두 개: `bench: legacy-demo 실측 결과(claude -p, sonnet, 12×2) — 산출물·채점·보고서` / `docs(readme): 벤치마크 결과 한 줄` (루트 세 명령 녹색 확인 후)

---

### Task 5 (컨트롤러 직접): 실제 레포 전 구간 기록(익명) + legacy-demo 쇼케이스 브랜치

**실행 주체:** 컨트롤러. 비공개 레포 복사본과 공개 브랜치 push 판단이 들어간다.

**Files:**
- Create: `docs/decisions/2026-11-01-real-repo-end-to-end.md`, `docs/showcase/legacy-demo.md`
- 브랜치(머지 안 함): `showcase/legacy-demo`, `showcase/legacy-demo-migrate`

**5-A. 실제 레포 전 구간(스펙 §3.2)** — 4a 컨트롤러 2와 같은 비공개 원본에서 **새 복사본**(이전 실행이 남긴 `.dsmith/`·`design-system/`·`.claude/`·`.mcp.json`·`AGENTS.md`·`.ds-cli/` 제거, 별도 git 작업 트리에 base 커밋). 빌드는 이 브랜치 HEAD의 `packages/cli/dist/bin.js`.
- [ ] `audit --json`(시간·점수·hardcodedShare·하드코딩 색 수·중복 수) → `init --dry-run --json`(커버리지 exact·close, 토큰 수) → `init --all`(토큰 파일·프리셋, `tokensLoaded` 안내 기록) → `decide --list --json --status pending`에서 **추천이 있는 duplicate 상위 5건**을 `--explain --json`의 추천 id로 `--choose`(N=5 — props 차이가 있으면 `--map` 없이 → migrate가 `mapping-missing`으로 보류하는 비율을 기록) → `migrate --json`(계획: 후보 = init 커버리지 replaceable인지, planned·close·사유별 건너뜀, 컴포넌트 계획·보류) → `migrate --apply --max-files 20 --branch ds/migrate-sample --with-tokens`(범위 제한 적용 1회: 바뀐 파일·치환 수·점수 전후·롤백 수, `parseTsx` 오류 증가 없음, 가능하면 그 레포 `tsc --noEmit` 오류 수 전후) → `guard init` → 커밋 → 합성 PR 커밋 2개로 `guard --ci --base <base 브랜치> --json`: (a) 토큰만 쓰는 변경 → `newHardcoded 0` (b) 하드코딩 색 1개 재유입 → 1, exit 1 → `migrate --revert <id>` 트리 해시(`.dsmith/` 제외) 동일
- [ ] 문서(익명, 기존 `2026-11-01-real-repo-coverage.md` 형식): 대상 설명(규모·스택만), 측정 방법(빌드 커밋 sha, 환경), 단계별 표(명령 · 핵심 숫자 · 시간), §11 형식 요약 3줄("하드코딩 색 N개 → 토큰 M개(범위 제한 적용 20파일 기준 / 계획 전체 기준을 구분)", "중복 <이름> k → 1(결정 5건 중)", "재유입 PR 검사: 신규 0건 → 합성 재유입 1건 탐지"), 보류·건너뜀 사유 상위와 실제 사례 3개(코드 조각은 일반화해 인용 — 식별자·경로 제거), 알려진 한계. 레포·회사·도메인·경로·사람 이름 금지
- [ ] Commit: `docs(decisions): 실제 레포 전 구간 기록(audit→init→decide→migrate→guard, 익명)`

**5-B. legacy-demo 쇼케이스(결정 10)** — 모노레포 작업 트리에서(Task 4 커밋 뒤의 `feat/benchmark` HEAD로 빌드한 CLI를 쓰되, 브랜치는 **main 기준**):
- [ ] `git switch -c showcase/legacy-demo main` → `node packages/cli/dist/bin.js audit --root examples/legacy-demo` → `init --all --root examples/legacy-demo` → `examples/legacy-demo/design-system/`만 커밋(`chore(showcase): legacy-demo에 dsmith init 산출(토큰 14·골격)` — 본문에 init 요약 출력 붙임). `.dsmith/`는 gitignore(`examples/**/.dsmith/`) 그대로
- [ ] `migrate --root examples/legacy-demo --json`(계획 저장) → `migrate --root examples/legacy-demo --apply --branch showcase/legacy-demo-migrate`(dsmith가 만든 커밋 그대로 — 부록 D.4.6에서 28건·52→59 확인). 커밋 작성자는 레포 설정(`Dahee Hwang`)
- [ ] 같은 브랜치에서 `guard init --root examples/legacy-demo` → `examples/legacy-demo/.dsmith/guard.json`은 `git add -f`로 강제 추가(디렉터리째 gitignore라 부정 패턴 불가) + 생성된 설정 파일 커밋 → 재유입 한 줄(`style={{ color: "#e11d48" }}`) 커밋 → `guard --ci --root examples/legacy-demo --base showcase/legacy-demo --json` 결과(1건, exit 1) 기록. (guard init의 ESLint 상태가 `needs-ts-parser` 등이면 그대로 기록 — 고치지 않는다)
- [ ] `git switch feat/benchmark` → `docs/showcase/legacy-demo.md`: 단계별 명령·실제 출력 발췌·숫자(점수 52→59, hardcodedShare, 치환 28, guard 0→1)·브랜치 이름과 커밋 sha·"main에 머지하지 않는 이유(e2e 스냅샷 고정)". 커밋 `docs(showcase): legacy-demo 적용 기록과 쇼케이스 브랜치 안내`
- [ ] **push:** `feat/benchmark`는 push한다. `showcase/*` 두 브랜치는 legacy-demo가 허구 데모라 공개 위험은 없지만 4a 원칙(공개 표면은 사용자 확인 뒤)에 따라 **사용자에게 push 여부를 묻는다** — 확인 전까지 문서에는 "로컬 브랜치, push 대기"로 적고, push 뒤 링크로 바꾼다

---

### Task 6: 최종 전체 브랜치 리뷰 + 보고

**실행 주체:** 리뷰어(Opus) → 수정은 구현자(Sonnet) → 컨트롤러가 머지·보고.

- [ ] **Step 1: 리뷰** — base `main`(0ae9042) … `feat/benchmark` HEAD 전체. Review Focus 1~6 + 아래:
  - 각 커밋 단독 빌드(`git rebase --exec "pnpm -r build && pnpm test && pnpm typecheck"` 대신 커밋별 체크아웃으로 확인 — 실패 범위는 보고만)
  - `score.ts`가 규칙을 재구현하지 않았는가(`evaluateFile` 밖 판정은 집계·차분·knownToken뿐)
  - 결과 md의 모든 숫자가 JSON에서 오는가, README 한 줄 = `readmeLine` 출력, replay 결과로 README 줄을 만들 수 없는가
  - 실측 산출물 몇 개를 직접 채점해 보고서와 대조, `results-replay.test.ts` 통과
  - 정리된 env·timeout·프로세스 그룹·임시 디렉터리 정리(테스트 뒤 `os.tmpdir()`에 `dsmith-bench-` 잔여 없음)
  - 익명 문서 두 개에 레포·회사·경로 단서가 없는가(`git grep`으로 비공개 레포에서 쓰인 고유 식별자 몇 개를 컨트롤러가 리뷰어에게 비공개로 주고 확인)
  - 기존 e2e 스냅샷 불변, 제품 패키지 diff 없음(`git diff main --stat -- packages/` 빈 결과)
- [ ] **Step 2: 수정 웨이브** — Critical/Important만 즉시, Minor는 판단 기록
- [ ] **Step 3: 머지** — `git merge --no-ff feat/benchmark`(main), 메시지 `merge: Plan 4b 벤치마크와 증명 — 하네스(claude -p 실측·replay), 실제 레포 전 구간 기록, legacy-demo 쇼케이스 (#plan-4b)`, 트레일러 없음. push는 사용자 지시에 따름
- [ ] **Step 4: 보고** — 사용자에게: README 한 줄(그대로), 실행 조건(N·반복·모델·비용), 프롬프트별 개선/같음/악화 수, 실제 레포 §11 형식 3줄, 쇼케이스 브랜치 상태(push 대기 여부), 알려진 한계

---

## 4b에서 하지 않는 것

- 반복 측정·여러 모델 비교·유의성 검정(`--repeat`는 지원만, 실측은 1회), `codex exec`·Cursor·Gemini 실측(바이너리 없음)
- 렌더링·스크린샷·타입 검사 기반 채점, LLM 채점자
- 에이전트가 `tokens.css`를 전역에 로드하거나 프리셋을 연결했는지 평가(측정 밖 — 보고서 한계 절)
- 비공개 레포에서의 벤치마크 실행(공개 legacy-demo만)
- 제품 패키지 변경·새 changeset(결정 11), npm 배포
- 4a의 알려진 한계 해결(Tailwind v4 변수 이름 겹침, 반투명 색 치환 등) — 4b가 숫자로 드러내기만 한다

## 완료 기준

- 루트 `pnpm -r build && pnpm test && pnpm typecheck` 통과(benchmarks 포함), 기존 e2e 스냅샷 불변, `git diff main --stat -- packages/` 비어 있음
- `pnpm bench:replay`가 네트워크 없이 결정적 결과를 내고 CI(vitest)에서 고정됨, 가짜 에이전트 e2e가 두 조건 준비·격리·timeout·기록→재채점을 덮음
- `benchmarks/results/<date>-legacy-demo.{json,md}` + outputs가 커밋돼 있고 `results-replay.test.ts`로 재현됨. 실측이 불가했으면 그 사실이 결과 문서에 있고 README 줄이 없음
- README 상단 한 줄 = `readmeLine` 출력, `## 벤치마크` 절
- `docs/decisions/2026-11-01-real-repo-end-to-end.md`(익명, §11 형식 3줄 포함), `docs/showcase/legacy-demo.md` + 로컬 `showcase/*` 브랜치(push는 사용자 확인)

---

## 부록 D. 확인 기록 (2026-11-01, 이 컨테이너에서 직접 실행)

구현자는 다시 조사하지 않는다. 여기 적힌 것은 모두 이 날짜에 명령을 실행해 본 결과다(Node v22.23.4, pnpm 10.28.0, git 2.43.0, main 0ae9042의 `packages/cli/dist/bin.js`). 프로브 복사본은 `/tmp/bench-*`·`/tmp/mono-*`(모노레포 밖)에 만들었다.

### D.1 `claude` CLI (Claude Code 2.1.316, `/opt/node22/bin/claude`)

1. **실행·프롬프트 전달:** `echo '<프롬프트>' | claude -p …` — stdin 프롬프트로 동작. 작업 디렉터리는 **프로세스 cwd**(`--cwd` 옵션 없음; stream-json init 메시지의 `cwd`가 복사본 경로). `codex`: `which codex` 실패(설치 안 됨)
2. **환경 변수:** 하네스 환경을 그대로 물려받은 실행의 결과 JSON `session_id`가 부모 세션 id와 같았다. `env -i HOME=$HOME PATH=$PATH claude -p …`는 인증·실행 정상, 새 `session_id`. → 결정 6
3. **AGENTS.md·CLAUDE.md 자동 로드:** 빈 디렉터리에 "모든 응답의 첫 줄에 정확히 CANARY-… 라고 쓰세요"만 담은 `AGENTS.md` / `CLAUDE.md`를 각각 두고 `claude -p --tools "" --model sonnet`(도구 없음 → 파일을 읽을 수 없음)에 "안녕이라고만 답하세요." → 각각 첫 줄 `CANARY-AGENTS-7` / `CANARY-CLAUDEMD-9`. **둘 다 시스템 컨텍스트로 자동 로드됨**
4. **프로젝트 `.mcp.json`:** `-p` 모드에서 승인 없이 연결 — stream-json init `mcp_servers: [{"name":"dsmith","status":"connected","source":"project"}]`, 도구 `mcp__dsmith__{explain_decision,get_component,lint_snippet,list_decisions,resolve_token,search_component}`. 별도 `--mcp-config`·`--strict-mcp-config`도 있으나 쓰지 않는다(레포에 install이 쓴 설정을 그대로 쓰는 것이 실사용과 같음)
5. **파일 쓰기 권한:** `--permission-mode acceptEdits`로 cwd 안 `Write`가 비대화식으로 허용됨(`permission_denials: []`). 읽기 전용 Bash(`ls`·`cat`·`git ls-files`)도 허용됨. 선택지: `acceptEdits | auto | bypassPermissions | manual | dontAsk | plan`, `--dangerously-skip-permissions`도 있으나 쓰지 않는다
6. **MCP 도구 권한:** dsmith 조건 복사본에서 "dsmith MCP의 resolve_token 도구로 #3b82f6 에 가장 가까운 토큰을 찾아 이름만 답하세요." — `--allowedTools` 없이: `permission_denials: ["mcp__dsmith__resolve_token"]`, 답 "권한이 아직 허용되지 않아서…". `--allowedTools mcp__dsmith`: denials 없음, 답 `` `--color-blue-400` ``. → **`--allowedTools mcp__dsmith` 필수**
7. **상한:**
   - `--max-turns <n>`: `--help`에 없지만 동작. `--max-turns 1` + 탐색이 필요한 요청 → `subtype "error_max_turns"`, `terminal_reason "max_turns"`, `num_turns 2`, `is_error true`, 종료 코드 1, 파일 생성 없음
   - `--max-budget-usd 0.001` → `subtype "error_max_budget_usd"`, `terminal_reason "budget_exhausted"`, `total_cost_usd 0.0250`(**한 턴 뒤 검사 — 초과 가능**), 그 턴의 파일 쓰기는 이미 반영됨, 종료 코드 1
   - `--model sonnet` → `modelUsage` 키 `claude-sonnet-5-5`. 한 실행에서 부수 작업용 `claude-haiku-5-5`가 함께 나타난 적 있음(비용 $0.0001) → 결과에 관측 모델 전부 기록
   - `--setting-sources project` → 사용자 수준 스킬(`file-reading`·`frontend-design`·`pdf-reading`·`product-self-knowledge`·`session-start-hook`)이 빠지고 레포 스킬(`ds`…`ds-migrate` 9개)과 내장 스킬만 남음
   - `--no-session-persistence`: 실행 성공. `~/.claude/projects/<복사본 경로 이름>/memory/`(빈 디렉터리)는 여전히 생김 — 복사본 경로가 실행마다 달라 실행 사이에 공유되지 않음
   - `--output-format stream-json --verbose` 조합으로 실행해 확인(`--verbose` 없이는 시험하지 않음 — 결정 5 명령은 늘 함께 쓴다). 마지막 줄 `{"type":"result","subtype":"success","num_turns":…,"total_cost_usd":…,"modelUsage":{…},"permission_denials":[…],"duration_ms":…,…}`; `--output-format json`은 같은 필드의 객체 하나
8. **결정 5 명령 전체**(`claude -p --output-format stream-json --verbose --model sonnet --max-turns 20 --max-budget-usd 0.5 --permission-mode acceptEdits --allowedTools mcp__dsmith --setting-sources project --no-session-persistence`)를 `env -i HOME PATH sh -c "$CMD"`로 baseline 복사본에서 실행(프롬프트 = 12-pagination 문형): 종료 0, `subtype success`, 4턴, $0.0639, 16.4초, 모델 `claude-sonnet-5-5`, denials 0, 바뀐 파일 `?? src/components/Pagination.tsx` 하나, stdout 35KB, stdout에 모노레포 경로 없음
9. **프로브 실행 비용·시간(sonnet):**

   | 조건 | 프롬프트 | 턴 | 비용 | 시간 | 도구 |
   | --- | --- | ---: | ---: | ---: | --- |
   | baseline | 배지(ProbeBadge) | 5 | $0.0699 | 15.2s | Bash×3, Write |
   | dsmith | 배지(ProbeBadge) | 8 | $0.0775 | 18.6s | Bash×3, ToolSearch, `mcp__dsmith__search_component`, Write, `mcp__dsmith__lint_snippet` |
   | baseline | Pagination(결정 5 명령) | 4 | $0.0639 | 16.4s | — |

   (주의: 첫 프로브 하나는 실수로 `ai`를 돌린 복사본(AGENTS.md 있음)을 baseline으로 써 응답이 "골격 단계라 쓰지 말라고 한 기존 Badge는 쓰지 않았습니다"였다 — AGENTS.md가 행동을 바꾼다는 방증이자, baseline 복사본에서 `AGENTS.md`·`.dsmith/`를 빼는 단언이 필요한 이유. 위 표에서 제외)
10. **DS 섹션이 프롬프트에 더하는 토큰**(같은 질문 "안녕이라고만 답하세요.", `--max-turns 1 --setting-sources project`, 입력 토큰 = input + cache_creation + cache_read):
    - `--tools ""`, 빈 디렉터리 2,698 → legacy-demo DS 섹션 `AGENTS.md`(1,144바이트)만 둔 디렉터리 3,346: **+648 토큰**
    - 기본 도구, baseline 복사본 17,182 → dsmith 복사본(AGENTS.md + `.mcp.json` dsmith 6도구 + 스킬 9개) 19,052: **+1,870 토큰**

### D.2 하네스 환경

- `env -i HOME PATH`로 `claude` 인증 가능(이 컨테이너는 하네스 인증 — `ANTHROPIC_API_KEY` 없음). 사용자 기기에서는 `ANTHROPIC_API_KEY` 등 결정 6 목록이 넘어간다
- 복사본에 `git init -b main` + 기준 커밋을 두면 실행 뒤 `git status --porcelain`에 에이전트가 만든 파일만 보였다(`.claude/`·세션 파일이 복사본에 생기지 않음)

### D.3 채점 커널 프로브 (legacy-demo 베이스 = 상태 1 + `init --all`, 스냅샷은 `buildGuardSnapshot`)

파일 `src/components/Probe.tsx`(`import { Button } from "@/components/ui/button"; import { Card } from "./Card";` + `className="bg-[#3b82f6] p-4 bg-[color:var(--color-blue-400)] p-[var(--space-2)] text-[var(--made-up)] bg-ds-blue-400 rounded-lg"` + `style={{ color: "#111827", padding: "var(--space-4)", margin: 8 }}`)의 `extractFileStyles` 결과:

| extractor | property | raw | source | rated |
| --- | --- | --- | --- | --- |
| tailwind | background-color | `bg-[#3b82f6]` | hardcoded | ✓ |
| tailwind | padding | `p-4` | tailwind-default | ✓ |
| tailwind | background-color | `bg-[color:var(--color-blue-400)]` | token | ✓ |
| tailwind | padding | `p-[var(--space-2)]` | token | ✓ |
| tailwind | other | `text-[var(--made-up)]` | token | ✗ |
| tailwind | background-color | `bg-ds-blue-400`(프리셋 미연결) | token | ✓ |
| tailwind | border-radius | `rounded-lg` | tailwind-default | ✓ |
| inline-style | color | `#111827` | hardcoded | ✓ |
| inline-style | padding | `var(--space-4)` | token | ✓ |
| inline-style | margin | `8` | hardcoded | ✓ |

컴포넌트: `Button`(module `src/components/ui/button`), `Card`(module `src/components/Card`). `evaluateFile` → `no-hardcoded-style` 3건(각각 `--color-blue-400`·`--color-blue-900`·`--space-2` 제안), `prefer-ds-component` 0, `summarizeFindings(eligibleFindings(…))` = `{ hardcoded: 3, replaceable: 3, nonDs: 0, deprecated: 0 }`.

실측 프로브 산출물 채점(같은 커널): baseline ProbeBadge `token 0 · hardcoded 1 · tailwind-default 11`, dsmith ProbeBadge `token 3 · hardcoded 0 · tailwind-default 0`, baseline Pagination `token 1 · hardcoded 0 · tailwind-default 15`, 셋 모두 nonDs 0.

### D.4 대상 레포 상태

1. **legacy-demo 원본 감지**(`audit`, 0.96s): 점수 52, `state 1`, `ds { kind: "local", dir: "src/components/ui", tokenFiles: ["src/lib/theme.ts"] }`, activeExtractors `tailwind, inline-style, css`. `ai`만 돌리면 경고 `토큰 파일 형식을 읽지 않음(건너뜀): src/lib/theme.ts`, 토큰 0, 컴포넌트 5
2. **결정 1 베이스(상태 1 그대로 `init --all`, 0.68s):** 토큰 14(color 6·spacing 4·radius 2·font-size 2, mergedValues 22), 커버리지 replaceable 58 / total 60(exact 29·close 29), 스캐폴드 1(Badge), `design-system/{tokens.json,tokens.css,tokens.ts,tailwind.preset.ts,components/Badge.tsx}`. `buildGuardSnapshot`: tokens 14, tokenSource `token-file`, ds.modules `design-system/components/Badge`·`src/components/ui`·`src/components/ui/button`·`src/components/ui/dialog`, components Button·Dialog·DialogContent·DialogTitle·DialogTrigger·Badge(scaffold), preset `design-system/tailwind.preset.ts` linked false keys 14
3. **dsmith 조건 `ai`:** sources `ds-local(src/components/ui)` + `init(design-system/components, tokens.json)`, 컴포넌트 6(props 추출 1), 토큰 14, `AGENTS.md` 마커 블록:
   ```
   - DS 위치: `src/components/ui` (로컬) · `design-system/` (dsmith init 초안)
   - 토큰 파일: `design-system/tokens.json` (토큰 14개) · CSS 변수: `design-system/tokens.css`
   - 컴포넌트 5개(props 추출 1) — 많이 쓰는 순: Button, Dialog, DialogContent, DialogTitle, DialogTrigger
   - 골격(구현 전) — 새 UI에 쓰지 말 것: Badge
   ### 규칙 1~5 (하드코딩 금지·resolve_token·search_component/get_component·deprecated 금지·/ds-check 또는 lint_snippet)
   ```
   대조: 상태 0 override + `init --all`이면 DS 섹션이 "컴포넌트 0개 · 골격(구현 전) — 새 UI에 쓰지 말 것: Badge, Button"(결정 1의 근거)
4. **`install --tool claude-code`:** `--mcp-command` 없으면 `.mcp.json` = `npx -y dsmith@0.1 mcp`(npm `dsmith` latest 0.1.0 — 작업 트리보다 낡음). `--mcp-command "node <abs>/packages/cli/dist/bin.js"`면 `.mcp.json` = `{"command":"node","args":["<abs>/packages/cli/dist/bin.js","mcp"]}`, 결과 `cli` = `node <abs>/packages/cli/dist/bin.js`(스킬 본문의 CLI 호출도 로컬 빌드). 생성: `.claude/skills/{ds,ds-ai,ds-audit,ds-check,ds-decide,ds-detect,ds-guard,ds-init,ds-migrate}/SKILL.md`, `.mcp.json`, `.dsmith/install.json`. **CLAUDE.md는 만들지 않는다**(D.1.3에 따라 AGENTS.md가 자동 로드되므로 문제없음)
5. **with-ds-app:** 파일 7개(소스 5: `components/ui/Button.tsx`, `src/legacy/Button.tsx`, `src/pages/{Admin,Home,Settings}.tsx` + `README.md`·`package.json`), `state 1`, ds local `components/ui`, tokenFiles 없음, activeExtractors `tailwind`, 점수 61. `init --all` → 토큰 1(color), 커버리지 2/2. `ai` → 컴포넌트 1(Button), 토큰 1
6. **`migrate --branch`가 하위 디렉터리 `--root`에서 동작:** 임시 git 레포 `<tmp>/examples/legacy-demo`(최상위는 `<tmp>`) → `audit`·`init --all`(상태 1) → 커밋 → `migrate --root examples/legacy-demo --apply --branch showcase/migrate --json`: 종료 0, planned 28, applied 28, 점수 52→59, hardcodedShare 0.3422→0.1925, 새 브랜치 `showcase/migrate`에 커밋 `chore(ds): 하드코딩 28건을 토큰으로 치환 (dsmith migrate)`(14 files changed, +25 −25, 경로는 `examples/legacy-demo/…`). `guard init`/`guard --ci`의 하위 디렉터리 동작은 4a Task 8 수정(`--relative`)으로 지원되지만 이 프로브에서는 돌리지 않았다 — Task 5에서 확인

### D.5 기존 기록에서 가져오는 숫자(재측정 대상)

4a 최종 컨트롤러 확인(스크래치 노트, 비공개 레포 복사본 약 1,143파일): audit 18.1s 점수 16; init 커버리지 exact 6,631 · close 4,375; migrate 계획 32.3s → planned 5,953(identical 5,858·exact 95) / 573파일, close 3,845, 건너뜀 translucent 132 · multi-value 1,076, candidates 11,006, 예상 점수 16→35(하드코딩 91.1%→54.5%), 컴포넌트 pending 500. Task 5-A는 이 숫자를 그대로 쓰지 않고 이 브랜치 빌드로 다시 잰다(차이가 있으면 문서에 둘 다)

### D.6 쓰는 export·패키지 상태(코드 읽기 + 실행)

- core: `extractFileStyles`, `extractorMatchers`, `extractComponentUsage`, `parseTsx`, `evaluateFile`, `eligibleFindings`, `findingKey`, `summarizeFindings`, `isRatedUsage`, `ruleContextOf`, `moduleContextOf`, `readGuardSnapshotSync`, `localDate`, `sha256Text`, 타입 `GuardSnapshot`·`Finding` — 모두 `packages/core/src/index.ts`에서 export(D.3 프로브가 `packages/core/dist/index.js`에서 import해 실행). guard: `buildGuardSnapshot`, `runGuardCi`. detect: `readDetect`
- `StyleSource` = `"hardcoded" | "tailwind-default" | "token" | "dynamic"`(`packages/extractor-api/src/extractor.ts`). `isRatedUsage`: property `other` 제외, hardcoded인데 normalized unknown 제외
- guard `ci.ts` `findingsOf`(줄 67~83)가 채점 조합의 원형: `extractFileStyles` → (스크립트면) `extractComponentUsage(file, parseTsx(code, file), snapshot.moduleContext.tsPaths, moduleContextOf(snapshot))` → `eligibleFindings(evaluateFile({ file, usages, components, ...ruleContextOf(snapshot) }))`, 신규 판정은 `findingKey` 다중집합 차
- `packages/eslint-plugin/src/registry.ts`의 `BUILTIN_EXTRACTORS`는 패키지 index에서 export되지 않음 → benchmarks가 같은 6개 이름표를 따로 둔다(키 고정 테스트)
- changeset: `.changeset/config.json` `fixed: [["dsmith", "@dsmith-dev/*"]]`; 대기 중 `ai-surface.md`·`ds-draft.md`·`migrate-guard.md`; `npm view dsmith dist-tags` → `latest 0.1.0`. 루트 `package.json` 스크립트는 `--filter './packages/*'`, `pnpm-workspace.yaml`은 `packages/*`만, `vitest.workspace.ts`는 `["packages/*"]` — benchmarks 편입은 세 곳 모두 수정 필요
