# Plan 4a: 적용·방어 (migrate · guard) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `dsmith migrate`가 `replaceableToken`과 **같은 규칙**으로 고른 하드코딩 사용을 각 Extractor의 `tokenRef`·`write`로 토큰 참조로 바꾼다. 기본은 계획만 보여 주고, `--apply`는 파일 단위 검증·기록·`--revert`, `--branch`는 git 브랜치와 커밋까지 만든다(PR은 열지 않는다). 결정(`decisions.json`)이 있는 중복 컴포넌트는 import를 DS 쪽으로 바꾼다. `dsmith guard`는 core 규칙 엔진 `evaluateFile` 하나를 ESLint 플러그인(`@dsmith-dev/eslint-plugin`, 동기)·`guard --ci`(PR diff, 코멘트 upsert)·MCP `lint_snippet`이 함께 쓰게 한다. Tailwind 레포는 `init`이 프리셋(v3 `tailwind.preset.*` / v4 `@theme` CSS)을 함께 만들어, 연결돼 있으면 클래스명으로 치환한다.

**Architecture:** 판단은 core에 둔다 — `tokens/draft.ts`의 `bestReplacement`(= `replaceableToken`이 고른 토큰), `patch/`(비중첩·역순 텍스트 패치, 역패치, 재파싱 검증, 해시 비교 쓰기), `migrations/`(기록 모델·저장), `git/run.ts`(timeout 있는 git 실행 — decisions 이력이 쓰던 것을 꺼냄), `fs/init-dir.ts`(catalog에서 이동), `tokens/tailwind-preset.ts`(프리셋 방출·키 파싱·연결 판정), `tokens/replacement-tokens.ts`(치환에 쓸 토큰 = 토큰 파일 > 카탈로그, 제안 제외), `rules/`(`evaluateFile`·`Finding`·정책), `guard/snapshot.ts`(`.dsmith/guard.json` 모델과 **동기** 읽기). 방식별 참조 문자열은 Extractor가 안다(`Extractor.tokenRef?`, extractor-api). 새 패키지 셋: `packages/migrate`(`@dsmith-dev/migrate`, 계획·적용·되돌리기·컴포넌트 편집·git 브랜치), `packages/guard`(`@dsmith-dev/guard`, 스냅샷·`guard init`·`guard --ci`·코멘트), `packages/eslint-plugin`(`@dsmith-dev/eslint-plugin`, 규칙 3개). CLI는 `migrate`·`guard` 서브커맨드로 노출만 하고, audit 점수 전후 비교처럼 CLI에만 있는 계산(`computeAudit`)은 CLI가 붙인다.

**Tech Stack:** 기존(TS 5.7 NodeNext, pnpm, vitest, @babel/parser 7.29, culori, fast-glob, picomatch, commander, diff, MCP SDK v2.4) + **새 외부 의존성 1개: `eslint`**(`packages/eslint-plugin`의 `peerDependencies: { "eslint": ">=9" }`, `devDependencies: { "eslint": "^10.14.0" }` — RuleTester·타입용). git은 런타임 바이너리(`git` 2.23+, `switch`)로만 쓴다. GitHub API는 Node 20 내장 `fetch`. 근거는 부록 C.

**Spec:** `docs/superpowers/specs/2026-11-01-migrate-guard-benchmark-design.md` (main b196fac) — §1 migrate, §2 guard, §4 공통 결정, §5 증명 포인트. §3(benchmark·실제 레포 전 구간 기록)은 Plan 4b — 이 계획은 훅(`evaluateFile`·`summarizeFindings` 순수 함수)만 남긴다. 3b 계획 `docs/superpowers/plans/2026-11-01-ds-draft.md`의 형식·Global Constraints를 계승하고, 3b 최종 리뷰 기록의 "Plan 4 inputs"(방식별 토큰 참조, `DecisionRecord.mapping` 추가 필드, ESLint용 동기 로더, `CatalogToken`의 DTCG 경로, `replaceableToken` 단일 규칙, `members` ≠ mapping)를 구속 조건으로 받는다.

## Global Constraints

- 3b Global Constraints를 그대로 따른다: 스코프 `@dsmith-dev/*`, ESM only, `tsconfig.base.json` 상속(`strict`·`noUncheckedIndexedAccess`·`exactOptionalPropertyTypes`), 한국어 conventional commit, **Co-Authored-By 없음**, author `dahee <dahee@project-hh.com>`, **각 커밋에서 루트 `pnpm -r build && pnpm test && pnpm typecheck` 녹색**, 테스트는 fixture를 임시 디렉터리로 복사해서 쓴다(원본 `fixtures/`·`examples/legacy-demo`는 절대 바꾸지 않는다)
- 새 패키지 셋은 `packages/extractor-css`의 `package.json`·`tsconfig.json`·`README.md`를 그대로 본떠 만든다(`version`·`license`·`author`·`homepage`·`repository.directory`·`publishConfig`·`files`·`engines`·`sideEffects`·`exports`·scripts 포함). 루트 `tsconfig.json` `references`에 `cli` **앞**에 추가(`eslint-plugin`은 extractor들 뒤, `migrate`·`guard`는 `catalog` 뒤). changeset `fixed` 그룹(`["dsmith", "@dsmith-dev/*"]`)이 자동으로 묶는다
- **의존 방향:** `extractor-api` ← `core` ← extractor 6종 ← `detect` ← `migrate` / `guard` ← `cli`. `eslint-plugin`은 `core`·`extractor-api`·extractor 6종만(**`detect`·`guard`·`migrate`·`cli`를 모른다** — 필요한 것은 전부 `.dsmith/guard.json` 스냅샷에서). `mcp-server`는 지금처럼 `core`·`detect`만. `migrate`와 `guard`는 서로 모른다. **core는 CLI·ESLint·GitHub를 모른다.** core의 프로세스 실행은 `git/run.ts` 하나뿐(timeout 필수)
- **Extractor 객체는 호출자가 넘긴다.** `migrate`·`guard`는 `Extractor[]`를 인자로 받는다(레지스트리는 CLI). ESLint 플러그인만 예외로 내장 6종 이름표를 갖는다(`packages/eslint-plugin/src/registry.ts`) — CLI `registry` 키와 같은지 CLI 쪽 테스트로 고정
- **`write`는 `extract`가 만든 바로 그 usage 객체로만 동작한다**(각 Extractor 모듈의 `WeakMap`). 인덱스 JSON에서 읽은 usage로는 패치를 만들 수 없으므로 migrate·guard·플러그인은 **파일을 다시 추출**해서 쓴다(`extractFileStyles` — usage 원본 객체를 복제하지 않는다)
- **치환 규칙은 하나:** 후보 = `source "hardcoded"` && `isRatedUsage` && `bestReplacement(usage, tokens) !== null`(= `replaceableToken`). `DraftToken.members`(병합된 원값)나 `ScaleMapping`(스케일 밖 → 먼 토큰 대응)을 치환 근거로 **쓰지 않는다**(3b 기록: members ≠ mapping). 제안 토큰(`source "proposal"`)으로는 치환하지 않는다
- **쓰기 규칙:**
  - migrate의 **소스 파일 편집**은 core `patch/`의 `writePatchedFile`(쓰기 직전 sha256 비교 → `atomicWrite`)로만 한다. 사용자 소스는 dsmith 소유 영역이 아니므로 `safeWrite`(매니페스트 소유권)가 아니라 **해시 비교 + `.dsmith/migrations/<id>.json` 기록 + `--revert`**가 안전장치다. 기록 파일을 소스보다 **먼저** 쓴다(중간에 죽어도 되돌릴 근거가 남는다)
  - `guard init`의 레포 파일 편집(ESLint 설정 마커 블록, `package.json` devDependency 키, `.github/workflows/dsmith-guard.yml`)은 **반드시 core `safeWrite`**(`confineTo: root`, 매니페스트 `.dsmith/guard-init.json`, `tool: "guard"`)
  - `init`의 Tailwind 프리셋 파일은 기존 init 쓰기와 같이 `safeWrite` managed(매니페스트 `.dsmith/init.json`) — 토큰 3파일 묶음과는 **따로**(묶음 보류 규칙 불변)
  - `.dsmith/` 안 상태 파일(`guard.json`, `migrations/*.json`, `reports/migrate-<date>.md`)은 core `atomicWrite`
  - migrate 계획(기본)·`--dry-run`류는 **어떤 파일도 쓰지 않는다**(`.dsmith/` 포함)
- 결정적 출력: `guard.json`·프리셋 파일·워크플로 파일·코멘트 본문에 타임스탬프·절대 경로 없음(두 번째 실행 바이트 동일). 예외: 마이그레이션 기록의 `id`·`createdAt`, 리포트 파일명 날짜
- 기존 e2e 스냅샷(`packages/cli/test/__snapshots__/e2e.test.ts.snap`, audit 7건·install 1건)은 바뀌면 안 된다. 바뀌면 원인을 보고서에 적고 멈춘다. agent-skill 렌더러 스냅샷은 Task 9에서 `ds`·`ds-decide`·`ds-migrate`·`ds-guard` 본문·행이 바뀌는 만큼만 갱신한다
- 기존 단위 테스트의 기대값이 이 계획의 **추가 필드**(`tokenRef`, `StyleObjectPatch.literal`, `StylingDetection.tailwindVersion`, `InitResult.tailwindPreset`, `DecisionRecord.mapping`, `Token.path` 등) 때문에만 깨지면 기대값을 갱신하고 보고서에 파일·테스트 이름을 적는다. 기존 필드 값이 바뀌면 멈춘다
- Babel AST는 7.x 이름만(3b 부록 B.3). `@babel/generator`는 쓰지 않는다 — 모든 편집은 **원문 텍스트 구간 패치**이고, 검증은 기존 `parseTsx`·`parseCssDeclarations`와 재추출로 한다(부록 C.5)
- ESLint 규칙은 **처음부터 끝까지 동기**다. 플러그인 코드에 `async`·`await`·`Promise`·`fs/promises`를 쓰지 않는다(테스트로 고정). `.dsmith/guard.json`은 `readFileSync`로 읽고 경로+mtime으로 캐시한다
- 외부 규약(ESLint 9/10 규칙·RuleTester, Tailwind v3 presets·v4 `@theme`, git 명령, GitHub REST 코멘트)은 부록 C가 정본이다. 해당 파일 상단 주석에 부록 C의 확인 날짜·출처를 옮긴다

## Review Focus

1. **숫자의 출처가 하나인가** — migrate 후보 수 = `replaceableToken` 참인 사용 수, init 커버리지 `replaceable`과 같은 레포에서 같은 값(차이는 사유별 건너뜀으로 전부 설명: `planned + Σskipped = candidates`). `bestReplacement`가 `replaceableToken`과 같은 판정인가(`replaceableToken`이 그 위에 한 줄로 서는가) → Task 1·4
2. **write 왕복** — 6개 Extractor 모두 conformance "write+tokenRef" 케이스: 치환 후 재추출하면 그 사용이 `source "token"`(같은 property)이고 나머지 사용의 (property, raw, source) 다중집합은 그대로 → Task 2
3. **파일 단위 원자성과 되돌리기** — 겹침 보류, 재파싱·재추출 검증 실패 시 그 파일 무변경, 쓰기 직전 해시 비교, `--revert` 후 트리 해시(`.dsmith/` 제외) 동일, 사용자가 그 뒤 고친 파일은 건너뜀 → Task 1·4
4. **Tailwind 클래스명이 기본 팔레트와 충돌하지 않는가** — 프리셋 키는 `ds-` 접두(`bg-ds-blue-400`), 연결 안 됐으면 임의값(`bg-[color:var(--color-blue-400)]`), 재추출 시 `token`으로 읽히는가(`text-ds-xs`는 font-size) → Task 2·3
5. **컴포넌트 편집이 보수적인가** — 결정된 항목만, props 차이는 `mapping` 없으면 보류, 스프레드 props 보류, 지역 정의는 **삭제·실제 import 추가 없이 주석만** → Task 5
6. **같은 엔진** — ESLint 규칙·`guard --ci`·MCP `lint_snippet`이 모두 core `evaluateFile`을 부르고, `lint_snippet` 출력이 바이트 호환인가(기존 테스트 무수정 통과) → Task 6·7·8
7. **ESLint 플러그인이 정말 동기인가** — guard.json 동기 로드·캐시, 스냅샷 없으면 조용히 무보고, `fix`는 exact만·`close`는 suggestion → Task 7
8. **CI 경로의 안전** — `--base`의 merge-base 기준 "신규"만 셈(줄 이동에 강한 키), 코멘트는 마커로 자기 것만 upsert, 코멘트 실패가 종료 코드를 바꾸지 않음, 워크플로 권한 최소(`contents: read`, `pull-requests: write`) → Task 8

---

## File Structure

```
packages/extractor-api/src/extractor.ts         TokenLike, TailwindPreset, TokenRefContext, TAILWIND_PRESET_PREFIX, cssVarRef, Extractor.tokenRef?
packages/extractor-api/src/conformance.ts       ConformanceCase.writes (write+tokenRef 왕복)
packages/extractor-{css,inline-style,styled,emotion,mui-sx,tailwind}/src/{write,extract,index}.ts   tokenRef 구현
packages/core/src/parse/object-style.ts         StyleObjectPatch.literal (문자열 리터럴 노드 전체 구간)
packages/core/src/tokens/draft.ts               bestReplacement (replaceableToken = bestReplacement !== null)
packages/core/src/tokens/w3c.ts, catalog/{model,tokens}.ts, model/token.ts   Token.path?(DTCG 경로) → CatalogToken
packages/core/src/tokens/replacement-tokens.ts  loadReplacementTokens (토큰 파일 > 카탈로그, 제안 제외)
packages/core/src/tokens/tailwind-preset.ts     emitTailwindPreset, parsePresetKeys, presetFormatFor, readTailwindPreset
packages/core/src/patch/{apply,validate,write}.ts  applyPatches, invertPatches, validateEdit, writePatchedFile
packages/core/src/migrations/{model,store}.ts   MigrationRecord, newMigrationId, read/write/listMigrations
packages/core/src/git/run.ts                    runGit (decisions/git-history.ts가 이걸 쓰도록)
packages/core/src/fs/init-dir.ts                findInitDir, readInitHashes (catalog에서 이동, catalog는 re-export)
packages/core/src/fs/safe-write.ts              block 영역 insertAt?
packages/core/src/index/component-usage.ts      moduleKeyOf (기존 moduleOf export)
packages/core/src/decisions/{model,choose}.ts   DecisionRecord.mapping?, ChooseOptions.mapping
packages/core/src/rules/{model,evaluate}.ts     Finding, GuardPolicy, DEFAULT_GUARD_POLICY, evaluateFile, findingKey, summarizeFindings
packages/core/src/guard/snapshot.ts             GuardSnapshot, GUARD_FILE, findGuardSnapshotSync, readGuardSnapshotSync, writeGuardSnapshot, ruleContextOf
packages/detect/src/detect-styling.ts           StylingDetection.tailwindVersion?
packages/init/src/run.ts                        Tailwind 프리셋 쓰기, InitResult.tailwindPreset
packages/migrate/                               새 패키지 @dsmith-dev/migrate
  src/{index,plan,apply,revert,components,specifier,git,report,project}.ts
packages/guard/                                 새 패키지 @dsmith-dev/guard
  src/{index,snapshot,init,eslint-config,workflow,ci,diff,comment,github}.ts
packages/eslint-plugin/                         새 패키지 @dsmith-dev/eslint-plugin
  src/{index,registry,analyze,rules/no-hardcoded-style,rules/prefer-ds-component,rules/no-deprecated-component}.ts
packages/mcp-server/src/tools/lint-snippet.ts   evaluateFile 위로
packages/cli/src/commands/{migrate,guard}.ts    + program.ts 등록, decide --map
packages/agent-skill/commands/{ds,ds-decide,ds-migrate,ds-guard}.md
README.md, packages/{migrate,guard,eslint-plugin}/README.md, .changeset/migrate-guard.md
```

**순서·의존:** T1 → T2 → T3 → T4 → T5 이 migrate 경로, T6 → T7 → T8 이 guard 경로, T9가 둘을 잇는다. T6은 T1만 필요(T2~T5와 병렬 가능), T7은 T2·T3·T6, T8은 T6·T7(설정 블록이 플러그인 이름을 씀 — 플러그인 설치 없이 테스트 가능). 모든 커밋은 그 시점에 단독 출시 가능(새 서브커맨드는 해당 Task에서 완결, 슬래시 명령 본문은 T9에서 교체).

---

### Task 1: core 치환 기반 — `bestReplacement`, `patch/`, `migrations/`, `git/run`, init-dir 이동, 치환 토큰 로더, DTCG 경로

**Files:**
- Create: `packages/core/src/patch/{apply,validate,write}.ts`, `packages/core/src/migrations/{model,store}.ts`, `packages/core/src/git/run.ts`, `packages/core/src/fs/init-dir.ts`, `packages/core/src/tokens/replacement-tokens.ts`
- Modify: `packages/core/src/tokens/draft.ts`, `packages/core/src/decisions/git-history.ts`(내부 `run` → `runGit`), `packages/core/src/model/token.ts`, `packages/core/src/tokens/w3c.ts`, `packages/core/src/catalog/tokens.ts`, `packages/core/src/index.ts`, `packages/catalog/src/{init-dir,build,index}.ts`(core에서 import, `findInitDir` re-export 유지)
- Test: `packages/core/test/{patch,migrations-store,git-run,init-dir,replacement-tokens}.test.ts`, `packages/core/test/token-draft.test.ts`(추가), `packages/core/test/tokens-w3c.test.ts`(추가), `packages/catalog/test/*`(import 경로만)

**Interfaces:**
- Consumes: `rankTokens`, `tokenCategoryOf`, `FULL_RADIUS_MIN_PX`, `COVERAGE_PROPERTIES`, `loadTokens`, `readCatalog`, `staleCatalogTokenFiles`, `parseTsx`, `parseCssDeclarations`, `atomicWrite`, `localDate`
- Produces:
  ```ts
  // tokens/draft.ts
  export interface Replacement { token: Token; confidence: "exact" | "close"; distance: number }
  /**
   * replaceableToken과 같은 판정으로 고른 토큰. 매처 1위가 exact|close면 그것,
   * 아니면 999px 이상 모서리 → px ≥ FULL_RADIUS_MIN_PX인 첫 radius 토큰(confidence: px 같으면 "exact", 아니면 "close", distance = |차|).
   * 대상 속성이 아니거나 바꿀 토큰이 없으면 null.
   */
  export function bestReplacement(usage: StyleUsage, tokens: Token[]): Replacement | null;
  export function replaceableToken(usage: StyleUsage, tokens: Token[]): boolean;   // = bestReplacement(usage, tokens) !== null (본문 교체, 시그니처 불변)

  // model/token.ts (추가 필드)
  export interface Token { name; value; normalized; category; /** W3C 토큰의 DTCG 경로("color.blue-400"). CSS 변수에서 읽은 토큰은 없음 */ path?: string }
  // w3c.ts readW3cTokens: path = 키 경로를 "."로 이음. catalog/tokens.ts readCatalogTokens: path가 있으면 CatalogToken에 그대로 싣는다(CatalogToken extends Token이라 타입 변경 없음)

  // patch/apply.ts (순수)
  export interface TextPatch { start: number; end: number; replacement: string }
  export interface PatchConflict { a: TextPatch; b: TextPatch }
  /** 같은 구간·같은 치환은 하나로 합친다. 구간이 겹치는(또는 한쪽이 다른 쪽을 포함하는) 패치는 양쪽 모두 conflicts로 빼고 accepted에서 제외. 길이 0 삽입은 같은 위치의 다른 삽입·구간 경계와 겹치지 않는 것으로 본다(start === 다른 패치 end 허용). accepted는 start 오름차순 */
  export function partitionPatches(patches: TextPatch[]): { accepted: TextPatch[]; conflicts: PatchConflict[]; merged: number };
  /** accepted(비중첩 전제)를 start 내림차순으로 적용. 중첩이면 Error(호출자 버그) */
  export function applyPatches(code: string, patches: TextPatch[]): string;
  /** 적용 뒤 좌표의 역패치: 오름차순으로 누적 길이 차를 더해 [start', start'+replacement.length) → original. applyPatches(applyPatches(c, p), invertPatches(c, p)) === c */
  export function invertPatches(original: string, patches: TextPatch[]): TextPatch[];

  // patch/validate.ts (순수)
  export type EditCheck = { ok: true } | { ok: false; reason: string };
  /**
   * .tsx/.jsx/.ts/.js/.mjs/.cjs/.mts/.cts: parseTsx가 던지면 실패, 아니면 after.errors.length ≤ before.errors.length.
   * .css/.scss: parseCssDeclarations 선언 수가 같고, 따옴표·주석 밖 `{`·`}`·`(`·`)` 균형 차이가 before와 같아야 함.
   * 그 밖의 확장자: { ok: false, reason: "검증할 수 없는 파일 형식" }
   */
  export function validateEdit(file: string, before: string, after: string): EditCheck;

  // patch/write.ts
  export const sha256Text: (text: string) => string;   // hex, 원문 그대로(BOM·CRLF 정규화 없음 — 바이트 일치가 목적)
  /** 현재 파일 sha256이 expected와 같을 때만 atomicWrite. 다르면 { written: false, reason: "계획 뒤 파일이 바뀜" }. 심볼릭 링크·root 밖이면 쓰지 않음 */
  export function writePatchedFile(root: string, file: string, expectedSha: string, content: string): Promise<{ written: boolean; reason?: string }>;

  // migrations/model.ts
  export interface MigrationPatch extends TextPatch { original: string }
  export interface MigrationFile {
    file: string;                         // root 상대 POSIX
    before: string; after: string;        // sha256Text
    patches: MigrationPatch[];            // 원본 좌표, start 오름차순
    status: "pending" | "applied" | "rolled-back" | "reverted" | "skipped-modified";
    reason?: string;
  }
  export interface MigrationRecord {
    version: 1;
    id: string;                           // "20261101-143005"(로컬 시각), 같은 초에 있으면 "-2", "-3"
    dsmith: string;
    createdAt: string;                    // ISO
    status: "applying" | "applied" | "reverted";
    summary: { tokens: number; components: number; files: number };
    branch?: { name: string; base: string; commit: string | null };
    files: MigrationFile[];
  }
  // migrations/store.ts — 경로 .dsmith/migrations/<id>.json, atomicWrite, JSON 2칸 들여쓰기 + "\n"
  export const MIGRATIONS_DIR = ".dsmith/migrations";
  export function newMigrationId(root: string, now: Date): Promise<string>;
  export function writeMigration(root: string, rec: MigrationRecord): Promise<string>;   // 반환: root 상대 경로
  export function readMigration(root: string, id: string): Promise<MigrationRecord | null>;  // id에 "/"·".." 있으면 Error
  export function listMigrations(root: string): Promise<{ id: string; status: MigrationRecord["status"]; summary: MigrationRecord["summary"]; branch?: string }[]>;   // id 내림차순

  // git/run.ts
  export interface GitResult { ok: boolean; code: number | null; stdout: string; stderr: string }
  /** execFile("git", args, { cwd: root, timeout, maxBuffer 8MB, encoding utf-8 }). ENOENT·타임아웃도 ok:false로(예외 없음). 기본 timeout 5000ms */
  export function runGit(root: string, args: string[], opts?: { timeoutMs?: number; input?: string }): Promise<GitResult>;

  // fs/init-dir.ts — catalog/src/init-dir.ts의 findInitDir·readInitHashes를 내용 그대로 이동

  // tokens/replacement-tokens.ts
  export interface ReplacementTokens {
    source: "token-file" | "catalog" | "none";
    tokens: LoadedToken[];      // proposal 없음
    files: string[];            // 읽은 토큰 파일(또는 카탈로그 토큰의 file 합집합)
    excludeFiles: string[];     // 치환 대상에서 뺄 파일: 읽은 토큰 파일 전부 + init 산출 디렉터리 아래(아래 excludeDirs)
    excludeDirs: string[];      // findInitDir(root)가 있으면 [그것]
    warnings: string[];
  }
  /**
   * 1) tokenFiles = detect의 ds.tokenFiles ∪ (initDir가 있으면 `${initDir}/tokens.css`·`tokens.json` 중 있는 것) — init 직후 detect.json이 낡아도 init 토큰을 찾게
   * 2) loadTokens(root, tokenFiles, []) 중 source "token-file" → 1개 이상이면 source "token-file"
   * 3) 아니면 readCatalog의 tokens(staleCatalogTokenFiles가 비었을 때만) → "catalog"
   * 4) 아니면 "none"
   */
  export function loadReplacementTokens(root: string, detectTokenFiles: string[]): Promise<ReplacementTokens>;
  ```
- [ ] **Step 1: 실패하는 테스트**
  - `bestReplacement`: 기존 `replaceableToken` 테스트 표(#3b82f6 exact, #3c83f7 close, #ef4444 null, padding 8 exact, 13 null, width null, 999px radius → `radius-full` close / 9999px → exact)를 그대로 돌려 `token.name`·`confidence` 단언. 그리고 "draftCoverage의 바꿀 수 있음은 replaceableToken과 같은 기준" 기존 테스트가 무수정 통과
  - patch: `partitionPatches` — 겹침 2개 → 둘 다 conflicts, 같은 패치 2개 → merged 1, 인접(`end === start`) 허용; `applyPatches`가 역순 적용(앞 패치가 뒤 좌표를 밀지 않음); `invertPatches` 왕복(길이 늘고 줄어드는 혼합, 빈 치환 포함) — 무작위 20케이스 property 테스트(시드 고정)
  - validate: tsx에서 `<div className="a">` → `<div className="a>` 같은 깨짐 → ok:false; 원래 errorRecovery 오류가 1개인 파일의 무관한 수정 → ok:true; css `color: #fff;` → `color: var(--c);` ok, `color: var(--c;` → ok:false(괄호 균형); `.md` → ok:false
  - `writePatchedFile`: 해시 일치 → 씀, 불일치 → `written:false`, root 밖 심볼릭 링크 → 쓰지 않음
  - migrations: `newMigrationId` 같은 초 두 번 → `-2`; write→read 왕복; list 내림차순; id `../x` → Error
  - `runGit`: 임시 디렉터리에서 `git init` → ok; 레포 아닌 곳 `rev-parse` → ok:false(예외 없음); `PATH=""`로 git 없음 → ok:false. `decisions-git.test.ts` 무수정 통과
  - init-dir: catalog 테스트가 import 경로만 바꿔 통과, core 테스트에 기존 4단계 규칙 케이스 이동
  - replacement-tokens: init 산출(`design-system/tokens.{json,css,ts}`)만 있고 detect tokenFiles가 비어 있어도 → `token-file`, `excludeDirs ["design-system"]`; 토큰 파일 없음 + 신선한 카탈로그 → `catalog`; 카탈로그 토큰 파일 해시 불일치 → `none`; 제안 토큰은 어떤 경우에도 없음
  - w3c: `readW3cTokens`의 `color.gray-50` → `path "color.gray-50"`; CSS 변수 토큰은 `path` 없음; `readCatalogTokens`가 path를 싣는다
- [ ] **Step 2: 실패 확인 → 구현 → 통과** — `pnpm -r build && pnpm test && pnpm typecheck`; e2e 스냅샷 불변
- [ ] **Step 3: Commit** — 세 개: `refactor(core,catalog): replaceableToken을 bestReplacement 위로, git 실행·init 산출 위치를 core로` / `feat(core): 비중첩 텍스트 패치·역패치·편집 검증과 마이그레이션 기록` / `feat(core): 치환용 토큰 로더(토큰 파일 > 카탈로그)와 W3C 토큰 DTCG 경로`

---

### Task 2: Extractor 계약 `tokenRef` + 6개 구현 + conformance write 왕복

**Files:**
- Modify: `packages/extractor-api/src/{extractor,conformance,index}.ts`, `packages/core/src/parse/object-style.ts`(`literal`), `packages/extractor-{css,inline-style,styled,emotion,mui-sx,tailwind}/src/{write,extract}.ts`(+ 필요한 곳 `index.ts`)
- Test: `packages/extractor-api/test/conformance.test.ts`(추가), 각 `packages/extractor-*/test/{extract,write}.test.ts`(conformance `writes` 케이스 ≥ 2 + tokenRef 단위)

**Interfaces:**
- Consumes: 기존 `write`·`registerPatchTarget`, `ParsedClass`(tailwind), `isSpacingProp`·`SPACING_UNIT_PX`(mui-sx)
- Produces:
  ```ts
  // extractor-api/src/extractor.ts (추가 — core Token과 구조 호환, extractor-api는 core를 모른다)
  export interface TokenLike { name: string; value: string; category: "color" | "spacing" | "radius" | "font-size"; normalized: StyleUsage["normalized"] }
  export interface TailwindPreset {
    version: 3 | 4;
    file: string;                        // root 상대 — v3 "design-system/tailwind.preset.ts"|".cjs", v4 "design-system/tailwind.theme.css"
    linked: boolean;                     // tailwind.config의 presets / CSS @import에 연결됐는가
    keys: Record<string, string>;        // CSS 변수 이름("--color-blue-400") → 클래스 키("ds-blue-400")
  }
  export interface TokenRefContext { /** 연결된 프리셋만 넘긴다(연결 안 됐으면 undefined) */ preset?: TailwindPreset }
  export const TAILWIND_PRESET_PREFIX = "ds";
  /** name이 /^--[A-Za-z0-9_-]+$/면 `var(${name})`, 아니면 null(CSS 변수가 아닌 토큰은 참조 형식 없음) */
  export function cssVarRef(token: TokenLike): string | null;

  export interface Extractor extends ExtractorMeta {
    // … 기존 그대로 …
    /**
     * 이 방식에서 token을 참조하는 문자열(= write의 tokenRef 인자). null이면 이 사용은 참조 형식이 없다(migrate가 no-token-ref로 건너뜀).
     * usage는 이 Extractor의 extract가 만든 객체여야 한다(구간 정보가 필요한 방식이 있다).
     */
    tokenRef?(token: TokenLike, usage: StyleUsage, ctx: TokenRefContext): string | null;
  }
  // metaOf는 바뀌지 않는다(tokenRef는 메타가 아님) — 기존 테스트 + "tokenRef가 있어도 metaOf 키는 name·files·parses(·signals)" 1건

  // conformance.ts (추가)
  export interface WriteCase {
    target: Partial<StyleUsage>;          // 원 usage를 고르는 부분 매칭(첫 일치)
    token: TokenLike;
    ctx?: TokenRefContext;
    ref: string | null;                   // tokenRef 기대값. null이면 null이어야 하고 이후 검사 생략
    output?: string;                      // 패치 적용 뒤 전체 코드 기대값(선택)
    reextract: Partial<StyleUsage>;       // 재추출 시 target.line과 같은 줄에 있어야 하는 usage(보통 { source: "token", property })
  }
  export interface ConformanceCase { code: string; file: string; expect: Partial<StyleUsage>[]; writes?: WriteCase[] }
  ```
  `runConformance`의 write 검사(케이스마다 새 인스턴스):
  1. `writes`가 있는데 `extractor.tokenRef`가 없으면 실패 `tokenRef 없음`
  2. extract → `target`과 부분 일치하는 첫 usage(없으면 실패) → `tokenRef(token, u, ctx ?? {})`가 `ref`와 같은지
  3. `write(u, ref)`가 null이면 실패. 패치를 문자열 splice로 적용(extractor-api는 core를 모르므로 직접) → `output` 비교(있으면)
  4. 같은 Extractor로 재추출 — 던지면 실패. `reextract`와 일치하는 usage가 `target.line`에 있어야 함
  5. 나머지 보존: 재추출 전 usage에서 target 하나를, 후 usage에서 reextract 일치 하나를 뺀 `${property}|${raw}|${source}` 다중집합이 같아야 함

  방식별 `tokenRef`(스펙 §1.2 — 아래 "결정" 포함):
  | Extractor | 규칙 |
  | --- | --- |
  | css(scss 포함) | `cssVarRef(token)` |
  | inline-style | `cssVarRef(token)` — write가 숫자 노드면 `"var(--x)"`로 감싼다(기존) |
  | styled / emotion | `cssVarRef(token)` — 템플릿은 그대로, 객체 숫자 노드는 write가 감쌈(기존). emotion은 styled의 tokenRef를 re-export |
  | mui-sx | 색·모서리·글꼴 크기: `cssVarRef`. 간격: `token.category === "spacing"` && `usage.normalized.px === token.normalized.px`(exact) && `px > 0` && `px % SPACING_UNIT_PX === 0` && 그 usage의 패치 구간에 `literal`이 있음 → `String(px / 8)`(테마 숫자 스케일), 아니면 `cssVarRef` |
  | tailwind | 아래 표 |

  tailwind(`PatchTarget`에 `utility: string`·`negative: boolean` 추가 — `ParsedClass`에서. `neg = negative ? "-" : ""`, `key = ctx.preset?.keys[token.name]`, 이름이 CSS 변수가 아니면 null):
  | token.category | 프리셋 키 있음 | 없음(임의값) |
  | --- | --- | --- |
  | color | `${utility}-${key}` | `${utility}-[color:var(${name})]` |
  | spacing | `${neg}${utility}-${key}` | `${neg}${utility}-[var(${name})]` |
  | radius | `${utility}-${key}` | `${utility}-[var(${name})]` |
  | font-size | `text-${key}` | `text-[length:var(${name})]` |
  (width·height는 토큰 대상 속성이 아니라 호출되지 않지만 방어로 null)

  추가 변경:
  - core `object-style.ts`: `StyleObjectPatch.literal?: { start: number; end: number }` — 값 노드가 `StringLiteral`이고 하위 구간이 따옴표 안 내용 전체(`start === node.start + 1 && end === node.end - 1`)일 때만. inline·styled·emotion은 무시
  - mui-sx `write`: `tokenRef`가 `/^\d+(\.\d+)?$/`(숫자 스케일)면 `literal`이 있을 때만 그 구간(따옴표 포함)을 숫자로 바꾸고, 없으면 null
  - tailwind 분류: `text-<v>`에서 `v`가 `/^ds-(xs|sm|base|lg|xl|[2-9]xl)(-\d+)?$/`면 `{ property: "font-size", normalized: unknown, source: "token" }`(프리셋 글꼴 크기 키 — 지금은 `color`로 잡힌다). `TAILWIND_PRESET_PREFIX`로 정규식을 만든다. **e2e 스냅샷 불변**(fixture에 `text-ds-*` 없음 — 2026-11-01 확인)
- [ ] **Step 1: 실패하는 테스트**
  - extractor-api: `writes` 있는데 tokenRef 없는 가짜 Extractor → 실패 사유 `tokenRef 없음`; ref 불일치·재추출 불일치·다른 usage가 사라지는 write → 각각 실패; 정상 가짜 → passed
  - css: `.a { color: #3b82f6; padding: 8px }` → `color` → `var(--color-blue-500)`, output 단언, 재추출 `source token`·`color`, padding 보존; 축약 `border: 1px solid #3b82f6` 색 부분만 → 재추출 `border-color` token(축약 분류가 var()를 token으로 못 읽으면 `classifyDeclaration`을 고친다 — 이 Task 범위)
  - inline-style: `style={{ padding: 8, color: "#3b82f6" }}` → `padding: "var(--space-2)"`, `color: "var(--color-blue-500)"`; 토큰 이름이 `color.brand`처럼 CSS 변수가 아니면 ref null
  - styled: 템플릿 `color: #3b82f6;` → `color: var(--color-blue-500);`, 객체 숫자 `fontSize: 13` → `fontSize: "var(--text-xs)"`; emotion 같은 2건(css prop 객체)
  - mui-sx: `sx={{ p: "16px" }}` + space-4(16px) → ref `"2"`, output `sx={{ p: 2 }}`, 재추출 `padding` token; `p: "13px"` + 12px 토큰(close) → `var(--space-3)`; `color: "#111"` → `"var(--color-gray-900)"`; `fontSize: 13` → `"var(--text-xs)"`
  - tailwind: `className="bg-[#3b82f6] md:p-[8px] -mt-[8px] text-[13px]"` — 프리셋 없음: `bg-[color:var(--color-blue-500)]`, `md:p-[var(--space-2)]`(variant 보존), `-mt-[var(--space-2)]`, `text-[length:var(--text-xs)]`; 프리셋 `{ keys: { "--color-blue-500": "ds-blue-500", "--space-2": "ds-2", "--text-xs": "ds-xs" } }`: `bg-ds-blue-500`, `md:p-ds-2`, `text-ds-xs` → 재추출 각각 `background-color`·`padding`·**`font-size`** token; `!bg-[#fff]`(important) 보존
  - 6개 Extractor의 기존 conformance·write 테스트 무수정 통과
- [ ] **Step 2: 실패 확인 → 구현 → 통과**; e2e 스냅샷 불변
- [ ] **Step 3: Commit** — 두 개: `feat(extractor-api): Extractor.tokenRef 계약과 conformance write 왕복 검사` / `feat(extractors): 6개 방식의 토큰 참조(tokenRef) — Tailwind 프리셋·임의값, MUI 숫자 스케일`

---

### Task 3: Tailwind 버전 감지 + 프리셋 방출·연결 판정 + `init`이 프리셋 생성

**Files:**
- Create: `packages/core/src/tokens/tailwind-preset.ts`
- Modify: `packages/detect/src/{detect-styling,index}.ts`, `packages/init/src/{run,report}.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/tailwind-preset.test.ts`, `packages/detect/test/*`(tailwindVersion), `packages/init/test/run.test.ts`(추가)

**Interfaces:**
- Consumes: Task 2 `TailwindPreset`·`TAILWIND_PRESET_PREFIX`, `TokenDraft`, `GENERATED_NOTICE`, Task 1 `findInitDir`
- Produces:
  ```ts
  // detect: StylingDetection (추가 필드)
  /** tailwind가 감지됐을 때만. package.json tailwindcss 범위의 첫 정수(^3.4.0 → 3, ~4.1 → 4; 숫자 없음·4 초과·3 미만 → 다음 근거) → `@import "tailwindcss"` 근거 → 4 → `@tailwind` 지시어·tailwind.config.* → 3 → 없음 */
  tailwindVersion?: 3 | 4;

  // core tokens/tailwind-preset.ts — 상단 주석에 부록 C.2
  export type PresetFormat = "v3-ts" | "v3-cjs" | "v4-css";
  export function presetFileName(format: PresetFormat): "tailwind.preset.ts" | "tailwind.preset.cjs" | "tailwind.theme.css";
  /** v4 → "v4-css". v3: 루트 tailwind.config 확장자가 .ts/.mts/.cts면 "v3-ts", 그 밖(없음 포함) "v3-cjs" */
  export function presetFormatFor(version: 3 | 4, configFile: string | null): PresetFormat;
  /** draft 순서. 키 = `${TAILWIND_PRESET_PREFIX}-${draftToken.key}`, 값 = `var(--${draftToken.name})` */
  export function emitTailwindPreset(draft: TokenDraft, format: PresetFormat): string;
  /** 생성 파일(사람이 고친 것 포함)에서 CSS 변수 → 클래스 키. v3: `"<key>": "var(<--name>)"` 줄, v4: `--<ns>-<key>: var(<--name>);`(ns ∈ color|spacing|radius|text) */
  export function parsePresetKeys(text: string, format: PresetFormat): Record<string, string>;
  /**
   * initDir 아래 세 이름 중 있는 파일 하나(v4-css > v3-ts > v3-cjs 순, tailwindVersion이 있으면 그 버전 것만)를 읽어 TailwindPreset.
   * linked — v3: 루트 tailwind.config.{ts,mts,cts,js,mjs,cjs} 중 하나의 텍스트에 `presets`가 있고 `<initDir>/tailwind.preset`(확장자 생략 허용, ./ 접두 허용)이 있음.
   *          v4: cssFiles(root 상대) 중 하나에 `@import`와 `tailwind.theme.css` 경로 끝이 같은 줄에 있음.
   * 프리셋 파일이 없으면 null.
   */
  export function readTailwindPreset(root: string, opts: { initDir: string | null; tailwindVersion?: 3 | 4; cssFiles: string[] }): Promise<TailwindPreset | null>;
  ```
  방출 모양:
  ```ts
  // v3-ts (v3-cjs는 첫 줄 이후 `module.exports = {` … `};`)
  // <GENERATED_NOTICE>
  // tailwind.config의 presets에 추가하세요: import dsPreset from "./design-system/tailwind.preset"; … presets: [dsPreset]
  export default {
    theme: {
      extend: {
        colors: {
          "ds-blue-400": "var(--color-blue-400)",
        },
        spacing: {
          "ds-2": "var(--space-2)",
        },
        borderRadius: {
          "ds-sm": "var(--radius-sm)",
        },
        fontSize: {
          "ds-xs": "var(--text-xs)",
        },
      },
    },
  };
  ```
  ```css
  /* <GENERATED_NOTICE> */
  /* Tailwind 진입 CSS에서 @import "tailwindcss"; 다음 줄에 @import "./design-system/tailwind.theme.css"; 를 추가하세요 */
  @theme inline {
    --color-ds-blue-400: var(--color-blue-400);
    --spacing-ds-2: var(--space-2);
    --radius-ds-sm: var(--radius-sm);
    --text-ds-xs: var(--text-xs);
  }
  ```
  빈 그룹은 생략(키 자체를 쓰지 않음). 값은 `tokens.css` 변수 참조라 `tokens.css`가 전역에 로드돼 있어야 한다(init 요약이 이미 안내 — 문구 유지)
  - `runInit`: `detected.styling.methods`에 tailwind가 있고 `tailwindVersion`이 있으면 `<outDir>/<presetFileName>`을 **managed 단독 write**로 추가(토큰 3파일 보류 묶음 밖). `InitResult.tailwindPreset: { version: 3 | 4; file: string; linked: boolean } | null`(추가 필드; dry-run이면 linked는 현재 파일 기준). 요약 한 줄: `Tailwind 프리셋: design-system/tailwind.preset.ts — 연결됨` 또는 `… — 연결 안 됨: tailwind.config의 presets에 추가하면 migrate가 클래스명(bg-ds-…)으로 치환`. tailwind인데 버전을 모르면 `warnings`에 `Tailwind 버전을 알 수 없어 프리셋을 만들지 않음`. 같은 디렉터리에 다른 형식의 프리셋 파일(예: 이번 `.ts`, 옛 `.cjs`)이 있으면 `warnings`에 `옛 프리셋 <file>이 남아 있음 — 확장자 없는 import가 그 파일을 먼저 집을 수 있으니 지우세요`(삭제는 하지 않는다, 부록 C.2). 리포트에 `## Tailwind 프리셋` 절
- [ ] **Step 1: 실패하는 테스트**
  - detect: tailwind-app(`^3.4.0`) → 3; legacy-demo(`^3.4.4`) → 3; 임시 `{"tailwindcss":"^4.1.0"}` → 4; 의존성 없이 `@import "tailwindcss"` CSS만 → 4; `"latest"` + `tailwind.config.js` → 3; tailwind 아님 → 필드 없음
  - preset: 고정 draft → v3-ts·v3-cjs·v4-css 스냅샷 3건; `parsePresetKeys(emit(d, f), f)` 왕복 = `{ "--color-blue-400": "ds-blue-400", "--space-2": "ds-2", "--radius-sm": "ds-sm", "--text-xs": "ds-xs" }`(세 형식 모두); 사람이 한 줄 지운 파일 → 그 키만 빠짐; v3-ts 출력이 `parseTsx` 오류 0; v4 출력이 `parseCssDeclarations`로 선언 수 = 토큰 수
  - `readTailwindPreset`: 프리셋 있음 + config에 `presets: [dsPreset]`·`import dsPreset from "./design-system/tailwind.preset"` → linked true; presets 없음 → false; v4 CSS `@import "../design-system/tailwind.theme.css";` → true; 파일 없음 → null
  - init: legacy-demo 복사본(상태 0 override) `runInit({ all: true })` → `design-system/tailwind.preset.ts` 생성(legacy-demo의 config가 `.ts`), `tailwindPreset.linked false`, 요약 문구; 두 번째 실행 unchanged·트리 해시 동일; 사람이 프리셋 수정 → `skipped-modified`이고 **토큰 3파일은 정상 갱신**(묶음 밖); `--dry-run` 무변경; tailwind 아닌 styled-app → 프리셋 없음·`tailwindPreset null`; 복사본에 `design-system/tailwind.preset.cjs`를 미리 두고 init(`.ts` 형식) → 옛 프리셋 경고 1건·옛 파일 보존
- [ ] **Step 2: 실패 확인 → 구현 → 통과**; e2e 스냅샷 불변(audit 리포트는 tailwindVersion을 출력하지 않는다)
- [ ] **Step 3: Commit** — 두 개: `feat(detect): Tailwind 주 버전(3·4) 감지` / `feat(core,init): Tailwind 프리셋(v3 presets·v4 @theme) 생성과 연결 판정`

---

### Task 4: `packages/migrate` — 토큰 치환 계획·적용·되돌리기 + CLI `migrate`

**Files:**
- Create: `packages/migrate/{package.json,tsconfig.json,README.md}`(extractor-css 본뜸; `name "@dsmith-dev/migrate"`, `description "dsmith migrate: replace hardcoded style values with design tokens, reversibly"`, 의존 `@dsmith-dev/core`·`@dsmith-dev/detect`·`@dsmith-dev/extractor-api`·`picomatch`), `src/{index,plan,apply,revert,project,report}.ts`
- Create: `packages/cli/src/commands/migrate.ts`; Modify: `packages/cli/src/program.ts`, `packages/cli/package.json`, `packages/cli/tsconfig.json`, 루트 `tsconfig.json`
- Test: `packages/migrate/test/{plan,apply,revert,project,report}.test.ts`, `packages/migrate/test/helpers.ts`(3b init 테스트 헬퍼와 같은 `copyFixture`·`auditFixture` 복제, Extractor 6종은 devDependencies), `packages/cli/test/migrate.test.ts`(fixture e2e), `packages/cli/test/cli.test.ts`(명령 이름 목록)

**Interfaces:**
- Consumes: Task 1 `bestReplacement`·`partitionPatches`·`applyPatches`·`invertPatches`·`validateEdit`·`writePatchedFile`·`sha256Text`·`MigrationRecord`·`newMigrationId`·`writeMigration`·`readMigration`·`listMigrations`·`loadReplacementTokens`, Task 2 `tokenRef`·`write`, Task 3 `readTailwindPreset`, `extractorMatchers`·`extractFileStyles`, `isRatedUsage`·`tokenCategoryOf`·`COVERAGE_PROPERTIES`, `Index`, `DetectResult`
- Produces:
  ```ts
  // plan.ts
  export type TokenSkipReason = "no-token-ref" | "no-patch" | "overlap" | "low-confidence" | "rolled-back";
  export type ComponentSkipReason = "decision-pending" | "mapping-missing" | "spread-props" | "export-unknown" | "overlap" | "rolled-back";   // Task 5가 채움
  export interface UsageRef { file: string; line: number; column: number; property: StyleProperty; raw: string; extractor: string }
  export interface PlannedReplacement extends UsageRef {
    category: Token["category"];
    token: string; value: string; confidence: "exact" | "close";
    ref: string;                              // tokenRef 결과
    patch: TextPatch;                         // write 결과
  }
  export interface SkippedReplacement extends UsageRef { reason: TokenSkipReason; token?: string }
  export interface FilePlan {
    file: string;
    sha256: string;                           // 계획 시점 내용
    replacements: PlannedReplacement[];
    components: PlannedComponentEdit[];       // Task 4에서는 항상 []
    patches: TextPatch[];                     // 최종(비중첩, start 오름차순)
  }
  export interface MigratePlan {
    tokens: { source: "token-file" | "catalog"; files: string[]; count: number };
    preset: { version: 3 | 4; file: string; linked: boolean } | null;
    scope: {
      files: number;          // 범위 안에서 다시 추출한 파일 수
      total: number;          // hardcoded && isRatedUsage && COVERAGE_PROPERTIES, 0 이하 간격 제외
      candidates: number;     // total 중 bestReplacement !== null
      far: number;            // total − candidates (가까운 토큰 없음)
      dynamic: number;        // source "dynamic" && isRatedUsage
      zeroOrNegative: number; // 0 이하 간격(분모 제외 — init 커버리지와 같은 규칙)
    };
    planned: number;          // = Σ files[].replacements.length
    byCategory: Record<Token["category"], number>;
    skipped: Partial<Record<TokenSkipReason, number>>;
    skippedItems: SkippedReplacement[];       // file → line → column 순
    files: FilePlan[];                        // patches가 1개 이상인 파일만, file 순
    components: ComponentPlanSummary;         // Task 4: { decided: 0, files: 0, imports: 0, props: 0, annotations: 0, pending: 0, held: {} }
    notes: string[];
  }
  // 불변식(테스트로 고정): planned + Σ skipped(TokenSkipReason) === scope.candidates, candidates + far === total

  export interface MigrateOptions {
    root: string;
    extractors: Extractor[];
    detect: DetectResult;
    index: Index;
    files?: string[];                         // picomatch glob(root 상대)
    category?: Token["category"];
    only?: "tokens" | "components";
    minConfidence?: "exact" | "close";        // 기본 close. exact면 close 후보는 low-confidence로 건너뜀
    maxFiles?: number;                        // patches가 있는 파일을 file 순으로 앞에서 n개(나머지는 계획에서 뺌 — notes에 "범위 제한으로 N개 파일 제외")
  }
  export function planMigration(opts: MigrateOptions): Promise<MigratePlan>;
  ```
  `planMigration` 절차:
  1. `rt = loadReplacementTokens(root, detect.ds.tokenFiles)`; `rt.source === "none"` → `Error("치환할 토큰이 없음 — 먼저 \`dsmith init\`(토큰 초안) 또는 토큰 파일을 두세요")`
  2. `preset = readTailwindPreset(root, { initDir: rt.excludeDirs[0] ?? null, tailwindVersion: detect.styling.tailwindVersion, cssFiles: index의 .css/.scss 파일 })`. 있고 `!linked`면 notes에 `Tailwind 프리셋(<file>)이 tailwind 설정에 연결되지 않아 임의값(bg-[color:var(--…)])으로 치환함 — 연결하면 클래스명(bg-ds-…)으로 바뀜`
  3. 대상 파일 = `index.styles`·`index.components`의 file 합집합 − `rt.excludeFiles` − `rt.excludeDirs` 아래 − `files` glob 밖, 정렬. 각 파일을 디스크에서 읽어 `extractFileStyles(ctx, extractorMatchers(extractors))`(던지면 그 파일은 notes에 `읽기 실패: <file>`)
  4. 사용마다: `isRatedUsage`가 아니면 무시; dynamic → `scope.dynamic`; hardcoded && `COVERAGE_PROPERTIES` && `category` 필터 → 0 이하 간격이면 `zeroOrNegative`, 아니면 `total`; `r = bestReplacement(u, rt.tokens)` null → `far`; 아니면 candidate → `minConfidence exact && r.confidence close` → `low-confidence`; Extractor(이름으로 찾음)에 `tokenRef` 없거나 null → `no-token-ref`; `write(u, ref)` null → `no-patch`; 아니면 PlannedReplacement
  5. 파일별 `partitionPatches` → conflicts에 걸린 계획은 `overlap`으로 옮김(같은 패치로 합쳐진 것은 계획 그대로 — 사용 수와 패치 수가 다를 수 있다: 두 Extractor가 같은 리터럴을 읽은 경우)
  6. `only === "components"`면 토큰 계획을 비운다(scope는 그대로 보고). `maxFiles` 적용
  ```ts
  // apply.ts
  export interface ApplyFileResult { file: string; status: "applied" | "rolled-back" | "changed-since-plan"; replacements: number; components: number; reason?: string }
  export interface ApplyResult { id: string; record: string; files: ApplyFileResult[]; replaced: number; components: number }
  export function applyMigration(root: string, plan: MigratePlan, opts: { extractors: Extractor[]; version: string; now?: Date; branch?: MigrationRecord["branch"] }): Promise<ApplyResult>;
  ```
  `applyMigration` 절차: id 생성 → 기록(`status "applying"`, 파일마다 `before`=plan sha, `after`=적용 결과 sha, patches+original, `status "pending"`)을 **먼저** 쓴다 → 파일마다 디스크 내용 sha ≠ plan sha → `changed-since-plan` / `after = applyPatches` → `validateEdit` 실패 → `rolled-back`(쓰지 않음) / 재추출 검증: 같은 Extractor로 `after`를 추출해 hardcoded 수가 정확히 `replacements` 수만큼 줄고 token 수가 그만큼 늘고 dynamic 수 불변 — 아니면 `rolled-back`(reason `재추출 검증 실패: hardcoded a→b, token c→d`) / `writePatchedFile` / 기록 갱신(`status "applied"`, 파일 상태). rolled-back 파일의 계획 수는 결과의 `skipped["rolled-back"]`로 보고
  ```ts
  // revert.ts
  export interface RevertResult { id: string; files: { file: string; status: "reverted" | "already-original" | "skipped-modified" | "missing"; reason?: string }[] }
  /** applied 파일만. 현재 sha === after → invertPatches 적용 → 결과 sha === before 확인 → writePatchedFile. === before → already-original. 그 밖 → skipped-modified("적용 뒤 수정됨"). 기록 status "reverted"(전부 되돌렸을 때) */
  export function revertMigration(root: string, id: string): Promise<RevertResult>;

  // project.ts (순수 — CLI가 예상 점수를 계산할 때)
  export function usageKey(u: UsageRef): string;            // `${file}:${line}:${column}:${property}:${extractor}:${raw}`
  /** plan의 계획 사용과 같은 키의 사용을 source "token"으로 바꾼 사본(나머지는 같은 객체) */
  export function projectStyles(styles: StyleUsage[], plan: MigratePlan): StyleUsage[];
  /** 카테고리별 남은 hardcoded(대상 속성) 수 */
  export function residualByCategory(styles: StyleUsage[]): Record<Token["category"], number>;

  // report.ts
  export interface AuditNumbers { score: number; hardcodedShare: number; residual: Record<Token["category"], number> }
  export function formatPlanSummary(plan: MigratePlan, projected: { before: AuditNumbers; after: AuditNumbers } | null): string;
  export function renderMigrateReport(input: { plan: MigratePlan; applied: ApplyResult; before: AuditNumbers; after: AuditNumbers }): string;
  ```
  CLI `dsmith migrate [--root] [--json] [--files <glob...>] [--category <c>] [--only tokens|components] [--min-confidence exact|close] [--max-files <n>] [--apply] [--branch <name>] [--revert <id>] [--list]` (`--branch`는 Task 5에서 동작, 이 Task에서는 `--apply` 없이 주면 오류만):
  1. `readDetect`·`readIndex` — 없으면 `runAudit(root)` 1회(stderr `인덱스가 없어 audit을 먼저 실행함`)
  2. `--list` → `listMigrations`; `--revert <id>` → `revertMigration` 후 `runAudit` 1회로 인덱스 갱신
  3. `plan = planMigration({ extractors: buildExtractors(detect.activeExtractors), … })`; `before = computeAudit(detect, index)`, `projectedAfter = computeAudit(detect, { ...index, styles: projectStyles(index.styles, plan) })`
  4. `--apply` 없으면 출력하고 끝(파일 무변경). 있으면 `applyMigration` → `runAudit(root)` → `after` → `.dsmith/reports/migrate-<localDate>.md`(`atomicWrite`)
  사람용 출력(숫자는 모양만):
  ```
  토큰: design-system/tokens.css 외 1 (token-file, 34개) · Tailwind 프리셋 연결 안 됨 → 임의값으로 치환
  계획: 파일 9 · 치환 40 (색 28 · 간격 9 · 모서리 2 · 글꼴 크기 1)
  후보 43 = 계획 40 + 건너뜀 3 (no-token-ref 1 · overlap 2)   |   범위 밖: 먼 값 49 · 동적 6
  예상: 하드코딩 비율 61.2% → 38.0%, 점수 52 → 63
  적용: dsmith migrate --apply   (되돌리기: dsmith migrate --revert <id>)
  ```
  `--apply` 뒤: `적용: 9개 파일 · 치환 40 (되돌린 파일 0) → 기록 .dsmith/migrations/20261101-143005.json` + `실제: 점수 52 → 63, 하드코딩 비율 61.2% → 38.0%` + `리포트: .dsmith/reports/migrate-2026-11-01.md`. `--json` = `{ plan, projected: { before, after }, applied: ApplyResult | null, actual: { before, after } | null }`
  리포트: `# DS Migrate` → 기록 id·토큰 출처 → `## 전/후`(점수·hardcodedShare·카테고리별 잔여 표) → `## 치환`(카테고리별 수, 파일별 수 상위 20) → `## 건너뜀`(사유별 수 + 사유 설명 한 줄씩) → `## 되돌리기` 명령
- [ ] **Step 1: 실패하는 테스트**
  - plan(합성 레포: css·inline·tailwind 파일 + `design-system/tokens.css`): 불변식 2개; `--category color` → 색만; `minConfidence exact` → close가 low-confidence; 토큰 이름이 CSS 변수 아닌 카탈로그 토큰 → no-token-ref; 두 패치가 겹치게 만든 가짜 Extractor 2개 → overlap 둘; `excludeDirs` 아래 파일(`design-system/tokens.ts`) 무시; 토큰 없음 → `먼저 \`dsmith init\``
  - apply: 계획 → 적용 → 파일 내용이 output과 같음, 기록 파일 존재·`status applied`; 계획 뒤 파일을 고치면 `changed-since-plan`·무변경; 검증 실패를 일으키는 가짜 Extractor(write가 따옴표를 깨뜨림) → `rolled-back`·무변경·다른 파일은 적용
  - revert: 적용 → revert → 트리 해시(`.dsmith/` 제외) 적용 전과 동일; 적용 뒤 한 파일 수정 → 그 파일 `skipped-modified`, 다른 파일 reverted; 두 번 revert → `already-original`
  - project: `projectStyles` 후 `computeAudit`(cli 테스트에서) hardcodedShare 감소
  - **cli e2e (`packages/cli/test/migrate.test.ts`)** — fixture 복사 → `runAudit` → (토큰 없음이면) `runInitCommand --all` → `runAudit` → migrate:
    - 7개 fixture(`tailwind-app`·`inline-app`·`styled-app`·`emotion-app`·`mui-app`·`mixed-app`·`with-ds-app`) + `legacy-demo` 각각: 불변식, `scope.candidates === index.styles.filter(u ⇒ hardcoded && isRatedUsage && 대상 밖 아님 && replaceableToken(u, tokens)).length`
    - `legacy-demo`(상태 0 override): `plan.scope.candidates === init의 coverage.replaceable`(같은 레포·같은 토큰 — §5 증명 포인트 1). 다르면 실패 메시지에 두 수와 차이 사용 목록
    - `--apply` → 재audit 점수 > 이전 점수(planned > 0일 때), `hardcoded` 감소량 = 적용한 치환 수 − (같은 리터럴 중복 추출 수); `--revert` → 트리 해시 동일
    - `tailwind-app`: 프리셋 미연결 → 계획 ref가 전부 `[color:var(` / `[var(` / `[length:var(` 형식, notes에 연결 안내; 테스트가 복사본 `tailwind.config.ts`에 `import dsPreset from "./design-system/tailwind.preset"; … presets: [dsPreset]`를 넣은 뒤 → ref가 `bg-ds-…`·`p-ds-…`
    - `with-ds-app`: 복사본에 `styles/tokens.css`(`:root { --brand-500: #3b82f6; --space-md: 8px; }`)를 두고 audit → init 없이 migrate가 그 토큰(`var(--brand-500)`)으로 계획
    - `mui-app`: `sx` 문자열 간격이 8의 배수면 숫자 ref(fixture에 해당 사용이 없으면 복사본에 `sx={{ p: "16px" }}` 한 줄을 넣고 단언), 기존 `p: 2`는 token이라 후보 아님
    - `--json` 모양, `--apply` 없이 실행하면 트리 해시(`.dsmith/` 포함) 무변경
- [ ] **Step 2: 실패 확인 → 구현 → 통과**; e2e 스냅샷 불변
- [ ] **Step 3: Commit** — 두 개: `feat(migrate): 하드코딩 → 토큰 치환 계획·적용·되돌리기(@dsmith-dev/migrate)` / `feat(cli): migrate 서브커맨드 (계획 기본, --apply·--revert·--list, 전후 점수 리포트)`

---

### Task 5: 결정 기반 컴포넌트 치환 + `DecisionRecord.mapping`(`decide --map`) + `--branch`

**Files:**
- Create: `packages/migrate/src/{components,specifier,git}.ts`
- Modify: `packages/core/src/decisions/{model,choose,store}.ts`, `packages/core/src/index/component-usage.ts`(`moduleKeyOf` export), `packages/core/src/index.ts`, `packages/migrate/src/{plan,apply,report,index}.ts`, `packages/cli/src/commands/{decide,migrate}.ts`, `packages/cli/src/program.ts`
- Test: `packages/migrate/test/{components,specifier,git}.test.ts`, `packages/core/test/decisions-choose.test.ts`(추가), `packages/cli/test/{decide,migrate}.test.ts`(추가)

**Interfaces:**
- Consumes: `readDecisions`, `resolveDefinitionFile`, `readComponentProps`, `readCatalog`, `parseTsx`, `traverse`, `readTsconfigPaths`, `TsPaths`, `resolveWithPaths`, `moduleOfFile`, Task 1 `runGit`·`partitionPatches`, Task 4 plan/apply
- Produces:
  ```ts
  // core decisions/model.ts (추가 필드)
  export interface DecisionRecord {
    // … 기존 …
    /**
     * 컴포넌트 치환 때 props 대응. 키·값 모두 "prop"(이름만 바꿈) 또는 "prop=value"(문자열 리터럴 값까지). 예
     * { "kind": "variant", "variant=primary": "variant=default" }. /ds-decide·`decide --map`이 채운다
     */
    mapping?: Record<string, string>;
  }
  // choose.ts: ChooseOptions.mapping?: Record<string, string> — 기존 "같은 선택·같은 메모면 그대로" 판정에 mapping 동등성도 포함. 형식 위반(빈 키, "=" 두 개 이상, 한쪽만 "prop=value") → Error
  // CLI: decide --item X --choose Y [--map <from>:<to>]... (반복). 예 --map kind:variant --map "variant=primary:variant=default"

  // core index/component-usage.ts
  export function moduleKeyOf(file: string, specifier: string, tsPaths: TsPaths | null, ctx: ModuleContext): string;   // 기존 moduleOf를 이름만 바꿔 export(동작 불변)

  // migrate/specifier.ts (순수)
  /** importer 파일에서 module 키를 가리킬 import specifier. 패키지 → 그대로. 경로 → tsconfig paths 패턴 중 대상 디렉터리가 module을 덮는 첫 별칭(`@/*` → `src/*`면 "@/components/ui/button"), 없으면 상대 경로("./"·"../" 접두, 확장자 없음) */
  export function specifierForModule(importer: string, module: string, tsPaths: TsPaths | null): string;

  // migrate/components.ts
  export interface ChosenTarget {
    item: string; kind: "duplicate" | "local-definition";
    module: string;                       // duplicate: 고른 module, local-definition: moduleOfFile(고른 파일)
    file: string | null;                  // 정의 파일(root 상대)
    exportKind: "named" | "default" | null;   // 정의 파일 파싱: `export function|const|class X`·`export { X }` → named, 아니면 `export default` → default, 패키지 → named, 모름 → null
    props: string[] | null;               // 카탈로그 컴포넌트 props(있으면) → readComponentProps → 모르면 null
    mapping: Record<string, string>;
    options: string[];                    // 결정 기록의 선택지(이 module들에서 온 import만 바꾼다)
  }
  export function resolveChosenTargets(root: string, decisions: DecisionsFile, index: Index): Promise<{ targets: ChosenTarget[]; pending: { item: string; kind: DecisionKind; files: number }[] }>;
  export interface PlannedComponentEdit { item: string; kind: "import" | "prop" | "annotate"; file: string; line: number; patch: TextPatch; detail: string }
  export interface HeldComponentEdit { item: string; file: string; line: number; reason: ComponentSkipReason; detail: string }
  /** 순수: 한 파일의 편집. 파일 안 한 항목은 전부 하거나 전부 보류(부분 치환 없음) */
  export function planComponentEdits(input: { file: string; code: string; targets: ChosenTarget[]; tsPaths: TsPaths | null; moduleContext: ModuleContext }): { edits: PlannedComponentEdit[]; held: HeldComponentEdit[] };
  export interface ComponentPlanSummary { decided: number; files: number; imports: number; props: number; annotations: number; pending: number; held: Partial<Record<ComponentSkipReason, number>> }
  ```
  duplicate 편집 규칙(파일마다, `ImportDeclaration`의 `moduleKeyOf(file, source)`가 `target.options` 중 `target.module`이 아닌 것이고 그 선언이 `item`을 들여올 때):
  1. `exportKind === null` → 보류 `export-unknown`
  2. 이 파일에서 그 로컬 이름으로 쓴 JSX 요소의 속성 검사: `JSXSpreadAttribute` → 보류 `spread-props`; 각 속성 `name`(문자열 리터럴 값이면 `name=value` 키 먼저) → `mapping`으로 바꾼 이름이 `props`에 없으면(props가 null이 아니고, `key`·`ref`·`children`·`className`·`style`·`aria-*`·`data-*`는 통과) → 보류 `mapping-missing`(detail에 빠진 prop 목록)
  3. import 편집: (a) 선언에 지정자가 그것 하나 → 선언 전체를 `import { Name } from "<spec>";`(default면 `import Name from "<spec>";`, 별칭 유지 `import { Name as Local }`)로 교체 (b) 지정자가 여럿 → 그 지정자(뒤 쉼표·공백 포함, 마지막이면 앞 쉼표)를 지우고, 파일에 이미 `<spec>`·같은 module 키의 named import가 있으면 그 `{ }` 끝에 `, Name` 삽입, 없으면 선언 끝 다음 줄에 새 import 줄 삽입 (c) 타입 전용 import(`import type`)는 건드리지 않음
  4. props 편집: `mapping`에 해당하는 속성 이름 구간, `prop=value` 매핑이면 값 문자열 리터럴 구간까지 패치
  local-definition 편집: `target.file`이 아닌 파일에서 `declaredLocally`로 `item`을 최상위 선언한 줄 위에 한 줄 삽입 — `// dsmith: <target.file>로 통합됨 — 삭제 검토 (import { Name } from "<spec>")`. **지역 선언 삭제·실제 import 추가는 하지 않는다**(같은 이름 바인딩 중복은 구문 오류). 이미 같은 주석이 있으면 건너뜀
  pending: duplicate/local-definition이 `pending`인 항목 → 그 이름을 쓰는 파일 수를 `pending`에 집계(편집 없음, 사유 `decision-pending`). token-cluster 결정은 무시(토큰 경로가 대표값으로 처리)
  - plan 통합: `only !== "tokens"`면 `planComponentEdits`를 토큰 계획과 같은 파일 단위로 합치고 `partitionPatches`로 겹침 검사(겹치면 양쪽 보류, 컴포넌트 쪽 사유 `overlap`). apply의 재추출 검증에 "그 파일 컴포넌트 사용 중 item의 module이 전부 target.module" 추가(local-definition 주석은 검증 대상 아님 — 구문 검증만)
  ```ts
  // migrate/git.ts
  export interface BranchCheck { ok: true; base: string } | { ok: false; reason: string }
  /** root가 git 작업 트리, `git var GIT_AUTHOR_IDENT` 성공(작성자는 레포 설정 — dsmith가 정하지 않음), refs/heads/<name> 없음, `git status --porcelain -- <files>` 비어 있음(대상 파일이 깨끗). base = 현재 브랜치 이름(분리 HEAD면 sha) */
  export function checkBranch(root: string, name: string, files: string[]): Promise<BranchCheck>;
  export function createBranch(root: string, name: string): Promise<void>;                // git switch -c <name>
  export function commitFiles(root: string, files: string[], message: string): Promise<string>;   // git add -- <files>; git commit -m <message> (timeout 30s) → rev-parse HEAD
  export function abandonBranch(root: string, base: string, name: string): Promise<void>;   // 적용 0건이면: git switch <base>; git branch -D <name>
  export function commitMessage(tokens: number, components: number): string;
  // 토큰만: "chore(ds): 하드코딩 N건을 토큰으로 치환 (dsmith migrate)"
  // 컴포넌트 포함: "chore(ds): 하드코딩 N건을 토큰으로, 컴포넌트 import M건을 DS로 치환 (dsmith migrate)"
  ```
  CLI `--apply --branch <name>`: 계획 → planned·편집 0이면 브랜치 없이 끝 → `checkBranch` 실패면 아무것도 쓰지 않고 오류 → `createBranch` → `applyMigration(…, { branch: { name, base, commit: null } })` → 적용 파일 0이면 `abandonBranch` → 아니면 `commitFiles(적용 파일들)`(`.dsmith/`는 커밋하지 않음) → 기록의 `branch.commit` 갱신 → 출력 `브랜치 ds/migrate-tokens에 커밋 abc1234 — PR은 직접 여세요`. **PR을 열거나 push하지 않는다**
- [ ] **Step 1: 실패하는 테스트**
  - decide: `--map kind:variant --map "variant=primary:variant=default"` → 기록 `mapping`; 형식 위반 → 오류; 같은 선택·같은 mapping 재실행 → 파일 불변
  - specifier: `@/*` → `src/*` 별칭 사용, 별칭 없으면 `../components/ui/button`, 패키지 그대로
  - components(순수, 합성 코드): 지정자 하나 → 선언 교체; 여럿 → 지정자 제거 + 새 줄; 기존 DS import에 합치기; 별칭 유지; default ↔ named 변환; `{...props}` → spread-props; 정의에 없는 prop → mapping-missing(빠진 이름), mapping 주면 이름·값 패치; `import type` 무시; local-definition 주석 1줄·두 번째 실행 중복 없음; 모든 출력이 `parseTsx` 오류 증가 없음
  - legacy-demo e2e: Button 중복을 `src/components/ui/button`으로 결정(props 차이가 있으면 mapping 없이 → 보류 수 단언, mapping 준 뒤 → 편집) → `--apply` → 재audit 중복 `Button` 사용처가 DS module로, 타입 오류 없음(`parseTsx`) / Badge pending → `pending` 집계 / `--only components`·`--only tokens` 분리
  - git(임시 레포): 깨끗한 트리 → 브랜치 생성·커밋 메시지·커밋에 `.dsmith/` 없음·작성자 = 레포 `user.name`; 식별 정보 없음(`HOME`·`GIT_CONFIG_NOSYSTEM`으로 격리) → 쓰기 전 오류·트리 무변경; 같은 이름 브랜치 있음 → 오류; 대상 파일 dirty → 오류; 계획 0건 → 브랜치 안 만듦
- [ ] **Step 2: 실패 확인 → 구현 → 통과**; e2e 스냅샷 불변
- [ ] **Step 3: Commit** — 세 개: `feat(core,cli): 결정 기록의 props 대응(mapping)과 decide --map` / `feat(migrate): 결정 기반 컴포넌트 import 치환과 지역 정의 통합 주석` / `feat(migrate,cli): migrate --apply --branch (브랜치·커밋, PR은 열지 않음)`

---

### Task 6: core 규칙 엔진 `evaluateFile` + guard 스냅샷 모델(동기 읽기) + MCP `lint_snippet` 교체

**Files:**
- Create: `packages/core/src/rules/{model,evaluate}.ts`, `packages/core/src/guard/snapshot.ts`
- Modify: `packages/core/src/index.ts`, `packages/mcp-server/src/tools/lint-snippet.ts`
- Test: `packages/core/test/{rules-evaluate,guard-snapshot}.test.ts`, `packages/mcp-server/test/*`(기존 lint_snippet 테스트 **무수정** 통과)

**Interfaces:**
- Consumes: Task 1 `bestReplacement`, `isRatedUsage`, `tokenCategoryOf`, `COVERAGE_PROPERTIES`, `ComponentUsage`, `TsPaths`, `atomicWrite`, Task 2 `TailwindPreset`
- Produces:
  ```ts
  // rules/model.ts
  export type RuleId = "no-hardcoded-style" | "prefer-ds-component" | "no-deprecated-component";
  export interface GuardPolicy {
    allow: { files: string[]; properties: StyleProperty[] };   // files: picomatch glob(root 상대)
    minConfidence: "exact" | "close";                            // replacement 제안 하한(이 아래면 replacement null)
    failOn: { newHardcoded: number; deprecated: number };        // guard --ci 임계(초과면 1)
  }
  export const DEFAULT_GUARD_POLICY: GuardPolicy;   // { allow: { files: [], properties: [] }, minConfidence: "close", failOn: { newHardcoded: 0, deprecated: 0 } }
  export interface DsComponentRef { name: string; module: string; modules?: string[]; deprecated?: string }
  export interface RuleContext {
    tokens: Token[];                                    // 치환 토큰(제안 없음)
    ds: { modules: string[]; components: DsComponentRef[] };
    preferred: { name: string; module: string }[];      // decided duplicate: 이 이름은 이 module로
    policy: GuardPolicy;
  }
  export interface Finding {
    rule: RuleId;
    file: string; line: number; column: number;         // column 0-based(StyleUsage와 같음)
    message: string;                                     // 한국어 한 줄
    usageIndex?: number;                                 // 입력 usages 배열의 인덱스(ESLint fix가 원본 usage 객체로 write하려고)
    style?: { property: StyleProperty; raw: string; extractor: string; category: Token["category"] | null;
              replacement: { token: string; value: string; confidence: "exact" | "close" } | null };
    component?: { name: string; module: string; preferModule?: string; deprecated?: string };
  }

  // rules/evaluate.ts (순수)
  export function evaluateFile(input: { file: string; usages: StyleUsage[]; components: ComponentUsage[] } & RuleContext): Finding[];
  /** 줄 이동에 강한 비교 키: style → `${rule}|${property}|${raw}`, component → `${rule}|${name}|${module}` */
  export function findingKey(f: Finding): string;
  export function summarizeFindings(fs: Finding[]): { hardcoded: number; replaceable: number; nonDs: number; deprecated: number };   // 4b 벤치마크 채점 훅
  ```
  `evaluateFile` 규칙(정렬: line → column → rule):
  - `allow.files`에 맞는 파일 → `[]`
  - `no-hardcoded-style`: `isRatedUsage(u) && u.source === "hardcoded" && !allow.properties.includes(u.property)` 전부(width·height 포함 — lint_snippet 호환). `replacement = bestReplacement(u, tokens)`(minConfidence exact면 close는 null). 메시지: replacement 있으면 `하드코딩 ${property} ${raw} — 토큰 ${token}(${value}) 사용`, 없으면 `하드코딩 ${property} ${raw} — 가까운 토큰 없음`
  - `prefer-ds-component`: 사용 `c`에 대해 (1) `preferred`에 같은 name이 있고 `c.module !== p.module` && `c.module !== ""` → preferModule p.module (2) 아니면 `ds.components`에 같은 name이 있고 `c.module`이 `ds.modules`에도 그 컴포넌트의 `module`/`modules`에도 없음(지역 선언 `declaredLocally`·import 없음 `""` 포함) → preferModule = 그 컴포넌트 module. 메시지 `${name}은 DS 컴포넌트(${preferModule})를 쓰세요`
  - `no-deprecated-component`: 같은 name이고 module이 그 DS 컴포넌트 module(또는 modules)이며 `deprecated`가 있음 → 메시지 `${name}은 deprecated: ${deprecated 첫 줄 ≤80자}`
  ```ts
  // guard/snapshot.ts — 동기 API는 node:fs의 *Sync만
  export const GUARD_FILE = ".dsmith/guard.json";
  export interface GuardSnapshot {
    version: 1;
    dsmith: string;
    extractors: string[];                               // detect.activeExtractors
    tokens: { name: string; value: string; category: Token["category"]; normalized: StyleUsage["normalized"]; path?: string }[];
    tokenSource: "token-file" | "catalog" | "none";
    tokenFiles: { file: string; sha256: string }[];     // 스냅샷을 만든 토큰 파일 내용 해시(낡음 경고용)
    ds: RuleContext["ds"];
    preferred: RuleContext["preferred"];
    preset: TailwindPreset | null;
    exclude: string[];                                  // 검사 제외 glob: DEFAULT_EXCLUDE + overrides.exclude + init 산출 디렉터리
    moduleContext: { tsPaths: TsPaths | null; baseUrlEntries: string[]; dependencies: string[] };
    policy: GuardPolicy;
  }
  /** fromDir에서 위로 올라가며 .dsmith/guard.json을 찾는다(파일 시스템 루트에서 멈춤). 없으면 null */
  export function findGuardSnapshotSync(fromDir: string): { root: string; file: string } | null;
  /** 읽고 모양 검사(version 1, 필수 키). 깨졌으면 Error(메시지에 파일 경로). policy 누락 키는 DEFAULT로 채움 */
  export function readGuardSnapshotSync(file: string): GuardSnapshot;
  export function writeGuardSnapshot(root: string, s: GuardSnapshot): Promise<string>;   // atomicWrite, 키 순서 고정, 2칸 + "\n"
  export function ruleContextOf(s: GuardSnapshot): RuleContext;
  export function moduleContextOf(s: GuardSnapshot): ModuleContext;   // 배열 → ReadonlySet
  ```
  - `lint_snippet`: `extractFileStyles` 결과를 `evaluateFile({ file, usages: styles, components: [], tokens: [], ds: { modules: [], components: [] }, preferred: [], policy: DEFAULT_GUARD_POLICY })`에 넘기고 `no-hardcoded-style` 결과를 `usageIndex`로 원 usage에 이어 `Violation`을 만든다(정렬·필드·`normalizedOf`·`summary`·`hint` 그대로). `suggestionFor`는 바꾸지 않는다(제안 단위·confidence 이름이 resolve_token과 같아야 함)
- [ ] **Step 1: 실패하는 테스트**
  - evaluate: 합성 usages(색 exact·close·far, padding 13, width 8, tailwind-default, dynamic, token) → no-hardcoded-style 수·replacement·메시지; `allow.properties ["width"]`·`allow.files ["**/legacy/**"]`; `minConfidence exact`; components — preferred(decided duplicate) 위반·준수, DS 이름의 지역 선언 위반, DS module 사용 통과, deprecated; 정렬; `findingKey`가 줄 번호에 무관
  - snapshot: write→readSync 왕복 바이트 결정적(두 번 쓰기 동일); 위로 찾기(하위 디렉터리에서); 깨진 JSON → 경로 포함 Error; policy 일부만 있음 → 기본값 채움; `guard/snapshot.ts`·`rules/*.ts` 소스에 `async`·`await`·`Promise`·`fs/promises` 문자열 없음(정적 검사 테스트 — 플러그인이 이 모듈을 쓴다)
  - mcp-server: 기존 lint_snippet·서버 테스트 무수정 통과
- [ ] **Step 2: 실패 확인 → 구현 → 통과**; e2e 스냅샷 불변
- [ ] **Step 3: Commit** — 두 개: `feat(core): 규칙 엔진 evaluateFile과 guard 스냅샷(.dsmith/guard.json) 동기 읽기` / `refactor(mcp-server): lint_snippet을 core 규칙 엔진 위로 (출력 불변)`

---

### Task 7: `packages/eslint-plugin` — `@dsmith-dev/eslint-plugin` (규칙 3개, flat config, 동기)

**Files:**
- Create: `packages/eslint-plugin/{package.json,tsconfig.json,README.md}`(extractor-css 본뜸; `name "@dsmith-dev/eslint-plugin"`, `description "ESLint rules for dsmith: no hardcoded style values, prefer design-system components, no deprecated components"`, `keywords`에 `"eslint"`·`"eslintplugin"`·`"eslint-plugin"`, 의존 `@dsmith-dev/core`·`@dsmith-dev/extractor-api`·extractor 6종·`picomatch`, `peerDependencies: { "eslint": ">=9" }`, `devDependencies: { "eslint": "^10.14.0", "vitest": "^3.0.0" }`), `src/{index,registry,analyze}.ts`, `src/rules/{no-hardcoded-style,prefer-ds-component,no-deprecated-component}.ts`
- Modify: 루트 `tsconfig.json`, `pnpm-lock.yaml`(설치), `packages/cli/test/registry.test.ts`(추가 1건)
- Test: `packages/eslint-plugin/test/{rules,analyze,plugin,sync}.test.ts`, `packages/eslint-plugin/test/helpers.ts`(임시 root에 `.dsmith/guard.json` 쓰기)

**Interfaces:**
- Consumes: Task 6 `findGuardSnapshotSync`·`readGuardSnapshotSync`·`ruleContextOf`·`moduleContextOf`·`evaluateFile`, Task 2 `tokenRef`·`write`, `extractorMatchers`·`extractFileStyles`, `extractComponentUsage`, `parseTsx`
- Produces:
  ```ts
  // registry.ts
  export const BUILTIN_EXTRACTORS: Record<string, Extractor>;   // "inline-style" | "tailwind" | "css" | "styled" | "emotion" | "mui-sx" → 각 패키지의 Extractor
  // cli/test/registry.test.ts: Object.keys(registry) 정렬 === ["css","emotion","inline-style","mui-sx","styled","tailwind"] (플러그인 표와 같은 목록)

  // analyze.ts
  export interface Analysis {
    root: string; file: string;                // file = root 상대 POSIX
    usages: StyleUsage[]; findings: Finding[];
    snapshot: GuardSnapshot;
  }
  /**
   * 같은 SourceCode 객체에 대해 한 번만 계산(WeakMap<SourceCode, Analysis | null>) — 규칙 3개가 공유.
   * 1) guardFile = context.settings.dsmith?.guardFile(절대 경로) ?? findGuardSnapshotSync(dirname(context.filename))
   * 2) 스냅샷 캐시: Map<path, { mtimeMs, snapshot }> — statSync mtime이 같으면 재사용
   * 3) 파일이 root 밖이거나 snapshot.exclude·policy.allow.files에 맞으면 null
   * 4) usages = extractFileStyles({ root, file, code: sourceCode.text }, matchers(snapshot.extractors → BUILTIN_EXTRACTORS))  — 던지면 null(파싱은 ESLint 파서의 몫)
   * 5) components = JS 파일이면 extractComponentUsage(file, parseTsx(text, file), snapshot.moduleContext.tsPaths, moduleContextOf(snapshot))
   * 6) findings = evaluateFile({ file, usages, components, ...ruleContextOf(snapshot) })
   * 스냅샷이 없거나 깨졌으면 null(규칙은 아무것도 보고하지 않는다 — 깨진 경우 한 번만 process.emitWarning)
   */
  export function analyze(context: Rule.RuleContext): Analysis | null;

  // index.ts
  declare const plugin: {
    meta: { name: "@dsmith-dev/eslint-plugin"; version: string };   // version은 package.json에서 createRequire로(동기)
    rules: { "no-hardcoded-style": Rule.RuleModule; "prefer-ds-component": Rule.RuleModule; "no-deprecated-component": Rule.RuleModule };
    configs: { recommended: Linter.Config };
  };
  export default plugin;
  // recommended = { name: "dsmith/recommended", files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"], plugins: { dsmith: plugin },
  //   rules: { "dsmith/no-hardcoded-style": "warn", "dsmith/prefer-ds-component": "warn", "dsmith/no-deprecated-component": "error" } }
  // (files가 없으면 ESLint가 .tsx에 "No matching configuration"으로 답한다 — 부록 C.1. parser는 정하지 않는다: TS 파싱은 사용자 설정의 typescript-eslint 몫)
  ```
  규칙 공통: `create(context)` → `{ Program() { const a = analyze(context); … } }`. `meta.type "suggestion"`, `schema: []`, `messages: { finding: "{{message}}", replace: "{{token}}로 바꾸기" }`. 보고 위치: 패치가 있으면 `sourceCode.getLocFromIndex(patch.start)`~`(patch.end)`, 아니면 `{ line, column }`(column 0-based 그대로)
  - `no-hardcoded-style`(`meta.fixable "code"`, `hasSuggestions: true`): finding의 `usageIndex`로 원 usage → Extractor(`BUILTIN_EXTRACTORS[u.extractor]`)의 `tokenRef(token, u, { preset: snapshot.preset?.linked ? snapshot.preset : undefined })` → `write(u, ref)` → confidence `exact`면 `fix: (f) => f.replaceTextRange([start, end], replacement)`, `close`면 `suggest: [{ messageId: "replace", data: { token }, fix }]`. ref·patch가 null이면 메시지만
  - `prefer-ds-component`, `no-deprecated-component`: 메시지만(fix 없음 — 컴포넌트 치환은 migrate의 일)
- [ ] **Step 1: 실패하는 테스트**(`RuleTester.describe = describe; RuleTester.it = it; RuleTester.itOnly = it.only;` — 부록 C.1. 코드 조각은 JSX만 쓰고 TS 문법은 쓰지 않는다: 기본 파서 espree + `languageOptions.parserOptions.ecmaFeatures.jsx`. 각 케이스는 `filename`을 임시 root 아래 절대 경로로, `settings.dsmith.guardFile`로 스냅샷 지정)
  - no-hardcoded-style: Tailwind `className="bg-[#3b82f6]"` + 토큰 `--color-blue-500`(#3b82f6) → error 1, output `bg-[color:var(--color-blue-500)]`; 스냅샷 preset linked(`keys`) → output `bg-ds-blue-500`; close 색(#3c83f7) → output 없음·suggestion 1(output 단언); 먼 색 → 메시지만; inline `style={{ padding: 8 }}` → output `"var(--space-2)"`; styled 템플릿 `color: #3b82f6;` → `var(--color-blue-500)`; sx `sx={{ p: "16px" }}` → output `p: 2`; `allow.files`·`allow.properties` → valid; 스냅샷 없는 디렉터리 → valid(보고 없음); tailwind-default `bg-blue-500` → valid
  - prefer-ds-component: `import { Button } from "./legacy/Button"; <Button />` + ds.components Button(`components/ui/button`) → 1건 메시지; DS에서 import → valid; preferred(결정) 위반
  - no-deprecated-component: catalog `deprecated: "Use Dialog"` → error 메시지
  - plugin: `meta.name`·`version` = package.json; `configs.recommended`로 `new Linter({ configType: "flat" }).verify(code, [recommended + settings], { filename: "<cwd 아래>/a.tsx" })` → 경고 수 = `evaluateFile` 결과 수(같은 엔진)
  - analyze: 같은 파일 두 규칙 → extract 1회(스파이); 스냅샷 mtime 바뀌면 다시 읽음; 깨진 스냅샷 → 보고 없음 + 경고 1회
  - sync: `src/**/*.ts`에 `async`·`await`·`Promise`·`fs/promises` 없음(정적 검사); 규칙 `create`의 반환이 thenable 아님
  - CSS: ESLint는 JS만 — `.css` 파일은 `recommended.files`에 없음을 단언(css는 `guard --ci` 경로)
- [ ] **Step 2: 실패 확인 → 구현 → 통과** — `pnpm install`(eslint devDependency) 후 루트 세 명령; e2e 스냅샷 불변
- [ ] **Step 3: Commit** — `feat(eslint-plugin): no-hardcoded-style·prefer-ds-component·no-deprecated-component (@dsmith-dev/eslint-plugin, flat config, 동기)`

---

### Task 8: `packages/guard` — `guard init`(스냅샷·ESLint 설정·CI 템플릿) + `guard --ci`(PR diff·코멘트) + CLI

**Files:**
- Create: `packages/guard/{package.json,tsconfig.json,README.md}`(extractor-css 본뜸; `name "@dsmith-dev/guard"`, `description "dsmith guard: design-system drift checks for pull requests and ESLint setup"`, 의존 `@dsmith-dev/core`·`@dsmith-dev/detect`·`@dsmith-dev/extractor-api`·`picomatch`), `src/{index,snapshot,init,eslint-config,workflow,ci,diff,comment,github}.ts`
- Create: `packages/cli/src/commands/guard.ts`; Modify: `packages/cli/src/program.ts`, `packages/cli/package.json`, `packages/cli/tsconfig.json`, 루트 `tsconfig.json`, `packages/core/src/fs/safe-write.ts`(`insertAt`)
- Test: `packages/guard/test/{snapshot,eslint-config,init,ci,comment,github}.test.ts`, `packages/core/test/safe-write.test.ts`(추가), `packages/cli/test/guard.test.ts`, `packages/cli/test/cli.test.ts`(명령 이름 목록)

**Interfaces:**
- Consumes: Task 6 전부, Task 1 `runGit`·`loadReplacementTokens`·`findInitDir`·`sha256Text`, Task 3 `readTailwindPreset`, `readCatalog`, `readDecisions`, `readTsconfigPaths`, `safeWrite`, `DEFAULT_EXCLUDE`, `extractFileStyles`·`extractorMatchers`·`extractComponentUsage`, `DetectResult`·`isDsSpecifier`
- Produces:
  ```ts
  // core fs/safe-write.ts (추가 필드)
  | { kind: "block"; start: string; end: string; /** 마커가 없을 때만: 이 줄 번호(0-based) 앞에 블록을 넣는다. 줄 수보다 크면 끝에 붙인다(기존 동작). 원본 기준이라 한 파일에 여럿이면 큰 줄 번호부터 넘긴다 */ insertAt?: number }
  // regionKey 불변(insertAt은 키에 들어가지 않음)

  // snapshot.ts
  /**
   * tokens = loadReplacementTokens(제안 없음), tokenFiles = 그 파일들의 sha256Text.
   * ds.modules: detect.ds가 npm이면 packageNames, local이면 dir, + 카탈로그 components의 module·modules 합집합(정렬).
   * ds.components: 카탈로그 components({ name, module, modules?, deprecated? }), 카탈로그 없으면 [].
   * preferred: decided duplicate 기록 → { name: item, module: chosen }(stale 제외).
   * exclude: DEFAULT_EXCLUDE + detect.overrides.exclude + init 산출 디렉터리(`<dir>/**`).
   * moduleContext: readTsconfigPaths + baseUrl 항목 + 의존성(indexer와 같은 수집 — 필요하면 indexer의 수집 함수를 core에서 export).
   * policy: existing?.policy ?? DEFAULT_GUARD_POLICY (사람이 고친 정책 유지)
   */
  export function buildGuardSnapshot(opts: { root: string; detect: DetectResult; version: string; existing: GuardSnapshot | null }): Promise<GuardSnapshot>;

  // eslint-config.ts (순수)
  export const ESLINT_IMPORT_MARKERS = { start: "/* dsmith:import:start */", end: "/* dsmith:import:end */" } as const;
  export const ESLINT_CONFIG_MARKERS = { start: "/* dsmith:start */", end: "/* dsmith:end */" } as const;
  export type EslintPlan =
    | { status: "insert"; file: string; importLine: number; configLine: number }   // 0-based insertAt
    | { status: "present"; file: string }                                          // 마커가 이미 있음 → 블록만 갱신
    | { status: "unsupported-shape"; file: string; snippet: string }
    | { status: "legacy"; file: string; snippet: string }                          // .eslintrc*
    | { status: "not-eslint"; tool: "biome" | "oxlint" }
    | { status: "no-config" };
  /**
   * detect.lint 기준. flat(eslint.config.{js,mjs,ts})이면 parseTsx로:
   *  importLine = 마지막 최상위 ImportDeclaration의 끝 줄 + 1(없으면 0)
   *  configLine = `export default [` / `export default defineConfig([` / `export default tseslint.config(` 의 여는 `[`·`(`가 그 줄의 마지막 비공백 문자인 줄 + 1
   *  못 찾으면(한 줄 배열, 변수로 내보냄 등) unsupported-shape. eslint.config.cjs → unsupported-shape(CJS에서 ESM 플러그인 require는 안내만)
   */
  export function planEslintConfig(root: string, lint: DetectResult["lint"], text: string | null): EslintPlan;
  export const IMPORT_BLOCK = 'import dsmith from "@dsmith-dev/eslint-plugin";';
  export const CONFIG_BLOCK = "  dsmith.configs.recommended,";
  export function eslintSnippet(): string;   // 사람이 붙여 넣을 import + 배열 항목 2줄

  // workflow.ts
  export const WORKFLOW_FILE = ".github/workflows/dsmith-guard.yml";
  export function renderWorkflow(version: string): string;   // 아래 템플릿, dsmith 버전 고정(npx --yes dsmith@<version>)

  // init.ts
  export interface GuardInitOptions { root: string; version: string; detect: DetectResult; ci?: "github"; dryRun?: boolean; force?: boolean }
  export interface GuardInitResult {
    snapshot: string;                                   // ".dsmith/guard.json"
    counts: { tokens: number; dsComponents: number; deprecated: number; preferred: number };
    eslint: EslintPlan["status"]; eslintFile?: string; snippet?: string;
    outcomes: WriteOutcome[];                           // eslint 블록 2개 + package.json devDependency + (ci면) 워크플로
    workflow: string | null;
    notes: string[];
    dryRun: boolean;
  }
  export function runGuardInit(opts: GuardInitOptions): Promise<GuardInitResult>;
  ```
  `runGuardInit` 절차: 기존 스냅샷 읽기(깨졌으면 무시하고 notes) → `buildGuardSnapshot` → `planEslintConfig` → writes(`safeWrite`, 매니페스트 `.dsmith/guard-init.json`, `tool "guard"`): `insert`/`present`면 config 블록(`insertAt: configLine`) **먼저**, import 블록(`insertAt: importLine`) 다음; 루트 `package.json` `json-key ["devDependencies", "@dsmith-dev/eslint-plugin"]` = `^<version>`(eslint 설정을 쓸 때만); `ci === "github"`면 워크플로 `file` 영역 → dryRun 아니면 스냅샷 `writeGuardSnapshot`. notes: `.dsmith/guard.json을 커밋해야 CI·ESLint가 같은 기준을 씁니다`, eslint 편집 시 `패키지 매니저로 설치하세요(예: pnpm install)`, legacy/unsupported면 snippet, biome/oxlint면 `guard의 즉시 검사는 ESLint 전용 — CI 검사(guard --ci)는 그대로 쓸 수 있음`
  워크플로 템플릿(부록 C.4 — 버전은 이 레포 CI와 같은 `@v4`):
  ```yaml
  # dsmith guard init이 생성한 파일입니다. 직접 고치면 다음 guard init이 덮어쓰지 않습니다(--force로 덮어씀).
  name: dsmith guard
  on:
    pull_request:
  permissions:
    contents: read
    pull-requests: write
  jobs:
    guard:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
          with:
            fetch-depth: 0
        - uses: actions/setup-node@v4
          with:
            node-version: 22
        - run: npx --yes dsmith@<version> guard --ci --base "origin/${{ github.base_ref }}" --comment
          env:
            GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  ```
  ```ts
  // diff.ts
  export interface ChangedFiles { base: string; mergeBase: string; files: string[] }
  /** git merge-base <base> HEAD → git diff --name-only --diff-filter=ACMR <base>...HEAD. 실패하면 Error(stderr 첫 줄 + "--base 브랜치를 fetch했는지 확인(actions/checkout fetch-depth: 0)") */
  export function changedFiles(root: string, base: string): Promise<ChangedFiles>;
  /** git show <mergeBase>:<file>. 없으면(새 파일) null */
  export function fileAtBase(root: string, mergeBase: string, file: string): Promise<string | null>;

  // ci.ts
  export interface GuardCiOptions { root: string; base: string; extractors: Extractor[]; comment?: boolean; env?: Record<string, string | undefined>; fetchImpl?: typeof fetch }
  export interface GuardCiResult {
    base: string; mergeBase: string;
    files: string[];                                    // 검사한 변경 파일(제외·Extractor 범위 밖 뺌)
    newFindings: Finding[];                             // head − base (findingKey 다중집합 차)
    counts: { newHardcoded: number; newReplaceable: number; newNonDs: number; newDeprecated: number; removedHardcoded: number };
    staleSnapshot: string[];                            // 기록 해시와 다른 토큰 파일
    exitCode: 0 | 1;                                    // newHardcoded > failOn.newHardcoded || newDeprecated > failOn.deprecated
    body: string;                                       // 코멘트 본문(마커 포함)
    comment: { status: "created" | "updated" | "unchanged" | "skipped" | "failed"; reason?: string } | null;
  }
  export function runGuardCi(opts: GuardCiOptions): Promise<GuardCiResult>;   // .dsmith/guard.json 없으면 Error("먼저 `dsmith guard init`")
  ```
  `runGuardCi`: 스냅샷 동기 읽기 → `changedFiles` → 파일마다(스냅샷 `exclude`·`allow.files`·Extractor glob 밖이면 뺌) head(디스크)·base(`fileAtBase`) 각각 추출 + 컴포넌트 사용 → `evaluateFile` → `findingKey` 다중집합 차로 신규·제거 → 스냅샷 토큰 파일 해시 비교(`staleSnapshot`, 본문에 경고 줄) → 본문 → `comment`면 upsert
  ```ts
  // comment.ts (순수)
  export const COMMENT_MARKER = "<!-- dsmith:guard -->";
  export function renderComment(r: Omit<GuardCiResult, "body" | "comment">, policy: GuardPolicy): string;
  ```
  본문(결정적, 시각 없음):
  ```md
  <!-- dsmith:guard -->
  ### dsmith guard
  기준 `origin/main` (merge-base `abc1234`) · 검사한 변경 파일 5

  | 항목 | 신규 | 허용 |
  | --- | --- | --- |
  | 하드코딩 스타일 | 3 (토큰으로 바꿀 수 있음 2) | 0 |
  | DS 밖 컴포넌트 | 1 | – |
  | deprecated 컴포넌트 | 0 | 0 |

  <details><summary>신규 하드코딩 3건</summary>

  | 위치 | 속성 | 값 | 제안 토큰 |
  | --- | --- | --- | --- |
  | `app/page.tsx:12` | background-color | `#3c83f7` | `--color-blue-500` (close) |
  </details>
  ```
  (표는 50행까지, 넘치면 `… 외 N건`. 하드코딩 제거만 있으면 `이 PR이 하드코딩 N건을 줄였습니다`. staleSnapshot이 있으면 맨 위 `> ⚠ 토큰 파일이 guard.json보다 새것입니다 — dsmith guard init으로 갱신하세요`)
  ```ts
  // github.ts — 부록 C.4. Node 내장 fetch, Accept "application/vnd.github+json", Authorization "Bearer <GITHUB_TOKEN>"
  export interface PrContext { apiUrl: string; repo: string; number: number; token: string }
  /** env: GITHUB_TOKEN, GITHUB_REPOSITORY("owner/repo"), GITHUB_EVENT_PATH(JSON의 pull_request.number), GITHUB_API_URL(기본 https://api.github.com). 하나라도 없으면 { error } */
  export function prContextFromEnv(env: Record<string, string | undefined>, readFile: (p: string) => string): PrContext | { error: string };
  /** GET /repos/{repo}/issues/{n}/comments?per_page=100&page=k (빈 페이지까지) 중 body에 COMMENT_MARKER가 있는 첫 코멘트 → 본문이 같으면 unchanged, 다르면 PATCH /repos/{repo}/issues/comments/{id}; 없으면 신규 0건(newFindings·removed 모두 0)일 때 skipped, 아니면 POST. HTTP 오류는 { status: "failed", reason: "<status> <message>" } — 예외 없음 */
  export function upsertComment(ctx: PrContext, body: string, opts: { fetchImpl: typeof fetch; createIfClean: boolean }): Promise<GuardCiResult["comment"]>;
  ```
  CLI: `dsmith guard init [--root] [--ci github] [--dry-run] [--force] [--json]`, `dsmith guard --ci --base <ref> [--root] [--comment] [--json]`(commander: `guard` 명령에 `--ci` 액션 + `init` 하위 명령). `--ci`는 본문을 stdout(사람용) 또는 `GuardCiResult`(`--json`)로 내고 `process.exitCode = exitCode`. 코멘트 실패는 stderr 경고만(종료 코드 불변)
- [ ] **Step 1: 실패하는 테스트**
  - safe-write: 마커 없는 파일 + `insertAt 2` → 2번 줄 앞에 블록; 마커 있으면 insertAt 무시하고 갱신; 같은 파일 블록 2개(큰 줄 먼저) 결과 순서; CRLF 보존; 기존 block 테스트 무수정 통과
  - eslint-config: `export default [\n  js.configs.recommended,\n];` → insert(import 0줄·config 1줄) → safeWrite 결과가 `parseTsx` 오류 0이고 `dsmith.configs.recommended`가 배열 첫 항목; `defineConfig([`·`tseslint.config(` 같음; 한 줄 배열 → unsupported-shape + snippet; `.eslintrc.json` → legacy; biome → not-eslint; 두 번째 실행 unchanged; 사람이 블록 수정 → skipped-modified
  - init(legacy-demo 복사본 + `eslint.config.mjs` 추가): 스냅샷 키 순서·바이트 결정적(두 번 실행 동일), tokens 수 = `loadReplacementTokens` 수, preferred = decided duplicate 수, 사람이 고친 policy 유지; `--ci github` → 워크플로 파일이 템플릿과 같고 YAML에 탭 없음; `--dry-run` → 트리 해시(`.dsmith/` 포함) 무변경
  - ci(임시 git 레포: legacy-demo 복사 → audit → init → guard init → commit "base" → 브랜치):
    - 하드코딩 색 2개를 추가한 커밋 → `newHardcoded 2`, exitCode 1, 본문 스냅샷 1건
    - 그 값을 `var(--color-…)`로 바꾼 커밋 → 0, exitCode 0
    - 기존 하드코딩 줄을 아래로 옮기기만 한 커밋 → 0(줄 이동 무관)
    - 하드코딩 하나를 지운 커밋 → `removedHardcoded 1`, 본문 "줄였습니다"
    - `failOn.newHardcoded: 5`로 policy 수정 → 2건이어도 exitCode 0
    - 토큰 파일 수정 후(스냅샷 갱신 안 함) → `staleSnapshot`·본문 경고
    - `.css` 파일 변경도 검사(ESLint가 못 보는 경로)
    - base ref 없음 → Error 메시지에 fetch-depth 안내
  - github(가짜 fetch): 마커 코멘트 없음 → POST 1회; 2페이지째에 마커 → PATCH 그 id; 같은 본문 → unchanged(요청 GET만); 403 → failed(예외 없음); env 누락 → `prContextFromEnv`가 error
  - cli: `guard init --json`·`guard --ci --base main --json`(임시 레포), exitCode 반영, 명령 이름 목록 갱신
- [ ] **Step 2: 실패 확인 → 구현 → 통과**; e2e 스냅샷 불변
- [ ] **Step 3: Commit** — 세 개: `feat(core): safeWrite 마커 블록의 삽입 위치(insertAt)` / `feat(guard): guard.json 스냅샷·ESLint 설정 블록·GitHub 워크플로(guard init)와 PR 드리프트 검사(guard --ci)` / `feat(cli): guard 서브커맨드 (init·--ci·--comment)`

---

### Task 9: 슬래시 명령 + 전 구간 e2e(legacy-demo: init → migrate → guard) + README + changeset

**Files:**
- Create: `packages/agent-skill/commands/ds-guard.md`, `.changeset/migrate-guard.md`
- Modify: `packages/agent-skill/commands/{ds,ds-decide,ds-migrate}.md`, `packages/agent-skill/test/{commands,renderers}.test.ts`(+ 스냅샷), `packages/cli/test/e2e-migrate-guard.test.ts`(신규), `README.md`, `packages/{migrate,guard,eslint-plugin}/README.md`
- Test: 위 테스트 + 기존 전부

**Interfaces:**
- Consumes: Task 4·5 `migrate`, Task 8 `guard`, Task 7 플러그인(`Linter`로 1건)
- Produces: 명령 본문(사람이 읽는 절차 — 숫자는 JSON 값만 말한다는 3b 규칙 유지)
  - `ds-migrate.md` (`uses: ["cli:migrate"]`, `args: "[--files <glob> | --category <c>]"`): 1) `npx dsmith migrate --json {{args}}`로 계획 → 2) 표로 보여줌(파일·카테고리별 치환 수, 건너뜀 사유별 수, 예상 점수 전후, notes — 프리셋 미연결이면 그 안내) → 3) 사람이 확인하면 `npx dsmith migrate --apply --branch ds/migrate-<날짜> {{args}}` → 4) 결과의 브랜치·커밋·리포트 경로와 `--revert <id>` 명령 전달, PR은 사람이 연다고 말함. 토큰 없음 오류면 `/ds-init` 안내. `mapping-missing` 보류가 있으면 `/ds-decide`로 mapping을 채우라고 안내
  - `ds-guard.md` (`uses: ["cli:guard init"]`, `args: "[--ci github]"`): `npx dsmith guard init --dry-run --json {{args}}` → 쓸 파일·ESLint 상태(insert/legacy/unsupported면 snippet) 보여줌 → 확인 후 `npx dsmith guard init {{args}}` → notes(guard.json 커밋, 패키지 설치) 전달
  - `ds-decide.md`: 4단계 뒤에 "카드 `differences`에 props 차이가 있으면 사람에게 대응을 묻고 `--map <from>:<to>`를 함께 넘긴다(값까지 바뀌면 `prop=value:prop=value`). 대응을 모르면 비워 둔다 — migrate가 그 사용을 보류한다" 추가
  - `ds.md`: 상태 1 경로 `/ds-audit` → `/ds-decide` → `/ds-ai` → `/ds-migrate` → `/ds-guard`; 상태 0 `… → /ds-init → /ds-ai → /ds-migrate → /ds-guard`; 상태 2 `/ds-ai` → `/ds-check` → `/ds-guard`. "아직 제공되지 않음" 문장 삭제
  - README: "적용·방어" 절 — migrate(계획 기본·`--apply`·`--branch`·`--revert`, Tailwind 프리셋 연결), guard(`guard init`, ESLint `recommended`, CI 워크플로, 코멘트), "같은 규칙 엔진" 한 단락. 버전 숫자 없음
  - changeset `.changeset/migrate-guard.md`: `"dsmith": minor`, `"@dsmith-dev/core"`, `"@dsmith-dev/extractor-api"`, extractor 6종, `"@dsmith-dev/detect"`, `"@dsmith-dev/init"`, `"@dsmith-dev/catalog"`, `"@dsmith-dev/mcp-server"`, `"@dsmith-dev/agent-skill"`, `"@dsmith-dev/migrate"`, `"@dsmith-dev/guard"`, `"@dsmith-dev/eslint-plugin"` 모두 minor. 본문 "적용·방어: `dsmith migrate`(토큰·결정 기반 컴포넌트 치환, 되돌리기, 브랜치 커밋), `dsmith guard`(ESLint 플러그인·PR 드리프트 검사), 규칙 엔진 공유". 버전 숫자 없음. `pnpm changeset status`로 새 세 패키지가 fixed 그룹에 들어갔는지 확인
- [ ] **Step 1: 실패하는 테스트**
  - agent-skill: `EXPECTED`에 `ds-guard` 추가; `ds-migrate`의 uses가 `["cli:migrate"]`이고 "아직 제공되지 않음"이 없음; `ds.md` 상태별 경로 문자열 3개; 렌더러 스냅샷은 바뀐 명령만
  - **전 구간 e2e (`e2e-migrate-guard.test.ts`)** — legacy-demo를 임시 git 레포로(`user.name`/`user.email` 레포 설정) → `audit`(점수 52 = 기존 스냅샷 값) → 상태 0 override → `init --all` → `audit` → `migrate --json`: `candidates === init coverage.replaceable`, 불변식 → 커밋 "base" → `migrate --apply --branch ds/migrate-tokens` → 브랜치·커밋 1개, 재audit 점수 > 52, hardcodedShare 감소 → `guard init` → `git add -A && commit` → `guard --ci --base main`: `newHardcoded 0`, exitCode 0(마이그레이션 PR은 하드코딩을 줄이기만 함, `removedHardcoded === 적용 치환 수 − 중복 추출`) → 새 커밋으로 `app/page.tsx`에 `style={{ color: "#e11d48" }}` 추가 → `guard --ci`: `newHardcoded 1`, exitCode 1 → 같은 파일을 `Linter` + `configs.recommended`로 lint → `dsmith/no-hardcoded-style` 1건(같은 엔진) → 별도 복사본에서 `migrate --apply` → `--revert <id>` → 트리 해시(`.dsmith/` 제외) 동일
  - 숫자 출력 일관: 사람용 출력의 계획 수 = `--json` 값 = 리포트 파일의 값
- [ ] **Step 2: 실패 확인 → 구현 → 통과** — 루트 세 명령; **기존 e2e 스냅샷 불변**
- [ ] **Step 3: Commit** — 두 개: `feat(agent-skill): /ds-migrate·/ds-guard 본문, /ds 상태별 경로에 migrate·guard, /ds-decide mapping (재설치로 교체)` / `test(cli),docs: migrate→guard 전 구간 e2e, README 적용·방어 절, changeset`

---

## 4a에서 하지 않는 것

- **4b 전부**: 벤치마크 하네스(`benchmarks/`, `--agent`·`--replay`, 12 프롬프트), 실제 레포 전 구간 기록 문서(`docs/decisions/2026-11-xx-real-repo-end-to-end.md`). 4a는 `evaluateFile`·`summarizeFindings`를 순수 함수로 남기는 것까지
- **자동 PR 생성·push**(migrate `--branch`는 로컬 커밋까지), 코드 삭제 codemod(지역 정의는 주석만), render-diff(`/ds-compare`), `usage` 대시보드, Figma 소스, MCP 쓰기 도구(`lint_snippet` 교체만)
- MUI 테마 커스터마이즈 해석(`createTheme`의 `spacing`·`shape` 값) — 숫자 스케일은 기본 테마 8px 전제. 모서리 숫자 스케일(`borderRadius: 1`)로의 치환
- Tailwind: 프로젝트 `tailwind.config`/`@theme` 자체를 읽어 사용자 정의 클래스 값을 해석하기, 프리셋을 config에 자동 연결하기(안내만), `bg-ds-x/50` 불투명도 수식어(v3에서 `var()` 색은 알파 수식어가 동작하지 않음 — 안내만), 기본 팔레트 이름을 다른 값으로 재정의한 프리셋 탐지(스펙 §1.2 마지막 문장 — `ds-` 접두로 충돌 자체를 피함), v4에서 init 토큰 이름(`--color-*`·`--radius-*`·`--text-*`)이 Tailwind 기본 테마 변수와 겹치는 문제(부록 C.2 미확인 항목 — 컨트롤러 4에서 확인만)
- ESLint: CSS/SCSS 파일 규칙(`@eslint/css` language — css는 `guard --ci`만), 레거시 `.eslintrc*` 자동 편집, `eslint.config.cjs` 자동 편집, Biome·oxlint 플러그인, typescript-eslint 파서 설정, `install --guard` 별칭(스펙 §2.1 괄호 — `guard init`만), npm `eslint-plugin-dsmith` 별칭 배포(2026-11-01 npm에 없음 — 4b 이후 결정)
- GitHub 외 CI(GitLab·Bitbucket), 포크 PR의 쓰기 권한 우회(`pull_request_target`) — 포크에서는 코멘트가 `failed`로 남고 종료 코드만 쓴다
- 시맨틱 토큰 별칭 치환(`--color-primary`를 `--color-blue-500` 대신 고르기), 다크 모드, shadow·typography 토큰, 색 alpha(3a부터의 한계)
- 모노레포 패키지별 migrate·guard(루트 하나), Windows 경로·`npx` 래핑

## 완료 기준

- 루트 `pnpm -r build && pnpm test && pnpm typecheck` 통과, **기존 e2e 스냅샷 불변**(audit 7건·install 1건)
- 스펙 §1.5 검증이 테스트로 고정: 7개 fixture + legacy-demo에서 `planned + Σskipped = candidates`, `candidates = replaceableToken 참인 수`, legacy-demo `candidates = init coverage.replaceable`, 적용 → 점수 상승, `--revert` → 트리 해시 동일, 겹침·동적·구문 오류(검증 실패) 롤백 케이스
- 6개 Extractor 모두 `tokenRef` 구현 + conformance write 왕복 케이스 ≥ 2, `metaOf` 불변
- 스펙 §2.2 검증이 테스트로 고정: ESLint `RuleTester`(Tailwind 임의값·inline·styled 템플릿·sx 숫자, fix는 exact만), `guard --ci` 임시 git 레포 시나리오(신규 N·종료 코드 1·본문 스냅샷·토큰으로 바꾼 커밋 0), legacy-demo `migrate --apply` 뒤 `guard --ci` 0건 → 재유입 1건
- MCP `lint_snippet` 기존 테스트 무수정 통과(같은 엔진으로 교체), ESLint 플러그인 소스에 비동기 없음
- 새 패키지 셋이 extractor-css 모양이고 changeset fixed 그룹에 들어감, `/ds-migrate`·`/ds-guard` stub 아님

## 컨트롤러 확인 항목 (최종 리뷰 뒤 오케스트레이터가 직접)

1. **legacy-demo 쇼케이스 브랜치**: dsmith 레포에서 `main` 기준 `demo/legacy-demo-init` 브랜치를 만들고 `node packages/cli/dist/bin.js audit --root examples/legacy-demo` → 상태 0 override(`.dsmith/detect.json`) → `init --all` → `design-system/`·`.dsmith/{decisions.json,detect.json}`만 커밋 → `migrate --root examples/legacy-demo`(계획 출력 저장) → `migrate --apply --branch demo/legacy-demo-migrate`로 커밋 생성 → `guard init --ci github` 커밋 → 재유입 한 줄 커밋으로 `guard --ci --base demo/legacy-demo-init` 결과(1건) 기록. 두 브랜치는 **main에 머지하지 않는다**(e2e 스냅샷 점수 52가 main의 legacy-demo에 고정). push는 사용자 확인 뒤(공개 표면). 기록할 숫자: 후보·계획·건너뜀 사유별·점수 전후·실행 시간
2. **비공개 실제 레포 복사본**(컨테이너 스크래치, 3b 컨트롤러 5와 같은 복사본, 별도 git 작업 트리): `audit` → `init --all` → `migrate --json`(후보 = init 커버리지 replaceable인지, 사유별 건너뜀, `no-token-ref`·`overlap` 실제 사례 3개씩 눈으로, 실행 시간) → `migrate --apply --max-files 20` → `parseTsx` 오류 증가 없음·가능하면 그 레포의 `tsc --noEmit` 오류 수 전후 동일 → `--revert` 트리 해시 동일 → `guard init` → 합성 커밋으로 `guard --ci`. 숫자만 스크래치 노트에(4b가 익명 문서로 씀). 결정 기반 컴포넌트 치환은 결정 1건만 골라 시험(mapping-missing 비율 기록)
3. **실제 ESLint**: legacy-demo 복사본에 `eslint@10.14.0`·`typescript-eslint`·로컬 `@dsmith-dev/eslint-plugin`(`file:` 또는 `pnpm pack`) 설치 → `guard init`이 만든 `eslint.config.mjs`로 `npx eslint app src` → 경고 수 = 같은 파일들의 `evaluateFile` 결과 수, `--fix`가 exact만 고침, 실행 시간(파일당). 같은 것을 `eslint@9.39.5`로 1회
4. **실제 Tailwind 빌드**: (v3) migrate 적용 + 프리셋 연결한 legacy-demo 복사본에서 `npx tailwindcss@3.4.19 -i app/globals.css` 출력에 `.bg-ds-…`·`.p-ds-…` 규칙과 `var(--…)` 값, 임의값 경로(`bg-[color:var(--…)]`)도 생성되는지. (v4) 스크래치 v4 앱에 `init`이 만든 `tailwind.theme.css`를 `@import` → `@tailwindcss/cli@4.3.3` 출력 확인 + `tokens.css`의 `--color-blue-400`·`--radius-sm`이 Tailwind 기본 테마 변수와 겹칠 때 `bg-blue-400`·`rounded-sm` 계산값이 바뀌는지 기록(부록 C.2 미확인 항목 — 바뀌면 후속 결정 항목으로)
5. **GitHub 코멘트**: 사용자 동의가 있으면 project-hh-org의 비공개 샌드박스 레포에 워크플로를 넣고 PR 하나로 created → 두 번째 push로 updated 확인. 동의가 없으면 "가짜 fetch 테스트만"이라고 부록 C.4 미확인 표에 남긴다
6. **실제 Claude Code 1회**: 1의 복사본에서 `install` 재실행 → `ds-migrate`·`ds-guard` SKILL.md가 `updated`/`created` → `/ds-migrate`가 계획 → 확인 → `--apply --branch`까지 가는지, 숫자가 JSON과 일치하는지

---

## 부록 C. 외부 규약 확인 기록 (2026-11-01)

구현자는 다시 조사하지 않는다. 해당 파일 상단 주석에 날짜·출처를 옮긴다. "미확인"은 폴백을 따른다. 로컬 프로브는 스크래치 디렉터리에서 npm 레지스트리 실제 패키지로 돌렸다.

### C.1 ESLint 9/10 플러그인·규칙·RuleTester — 확인(릴리스 공지 + 로컬 프로브)

- 버전(npm 레지스트리 dist-tags, 2026-11-01): `latest 10.14.0`, `maintenance 9.39.5`. eslint.org 머리말 "ESLint v9.x reached end-of-life on 2026-08-06". 출처: `npm view eslint dist-tags`, https://eslint.org/blog/2026/02/eslint-v10.0.0-released/ (2026-02-06)
- v10 변경 중 플러그인 관련(공지 인용): 규칙 context의 `getCwd()`·`getFilename()`·`getPhysicalFilename()`·`getSourceCode()`·`parserOptions`·`parserPath` 제거 → `context.cwd`·`filename`·`physicalFilename`·`sourceCode`·`languageOptions` 사용; eslintrc 완전 제거(`.eslintrc.*` 무시); 설정 파일을 "각 lint 대상 파일의 디렉터리부터" 찾음; Node `^20.19.0 || ^22.13.0 || >=24`; RuleTester에 `requireMessage`·`requireLocation`·`requireData` 옵션 추가, invalid 케이스 검사가 더 엄격; `Program` 노드 range가 전체 텍스트
- **결정:** `peerDependencies.eslint ">=9"`, 규칙은 `context.sourceCode`·`context.filename`·`context.settings`만 쓴다(9·10 공통). 레거시 eslintrc는 지원하지 않는다
- 로컬 프로브(eslint 9.39.5·10.14.0 둘 다 같은 결과):
  - 플러그인 객체 `{ meta: { name, version }, rules: { r }, configs: { recommended: { plugins: { probe: plugin }, rules } } }`가 flat config에서 동작
  - 규칙 `{ meta: { type, fixable: "code", hasSuggestions: true, messages, schema: [] }, create(context) { return { Program() { … } } } }`; `context.sourceCode.text`, `sourceCode.getLocFromIndex(i)`(0-based column), `context.report({ loc: { start, end }, messageId, data, fix: (f) => f.replaceTextRange([s, e], text), suggest: [{ messageId, data, fix }] })`
  - `new RuleTester({ languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } })` + `run(name, rule, { valid, invalid: [{ code, filename, output, errors: [{ messageId, line, column, suggestions: [{ messageId, output }] }] }] })` 통과. **errors의 `column`은 1-based**(보고 loc의 0-based column + 1). `filename`에 임의 절대 경로 허용, 케이스 `settings`가 `context.settings`로 전달됨
  - `Linter#verify(code, [config], { filename: "a.tsx" })`: config에 `files`가 없으면 "No matching configuration found for a.tsx." → **recommended에 `files` 글롭 필수**. cwd 밖 절대 경로 filename도 같은 메시지(테스트는 cwd 아래 경로)
  - `.css`를 기본 JS 언어로 lint → "Parsing error: Unexpected token {" → **CSS는 ESLint 경로에서 다루지 않음**(별도 language 플러그인 `@eslint/css`가 필요 — 범위 밖)
  - config 객체의 `name` 키 허용
- 미확인(문서 페이지 https://eslint.org/docs/latest/extend/custom-rules · …/extend/plugins · …/use/migrate-to-10.0.0 는 이 세션에서 열람 승인이 나지 않음): `RuleTester.describe/it/itOnly` 정적 설정자로 vitest에 연결하는 방식(널리 쓰이는 관용 — 프로브는 vitest 밖 기본 러너로 실행). 폴백: 안 되면 `RuleTester.run`을 vitest `it` 안에서 직접 호출하고 예외로 실패 판정. `meta.namespace` 필드는 쓰지 않는다

### C.2 Tailwind v3 presets / v4 `@theme` — 확인(로컬 빌드 프로브)

- 버전(npm dist-tags, 2026-11-01): `tailwindcss latest 4.3.3`, `v3-lts 3.4.19`
- v3 프로브(`tailwindcss@3.4.19`, `npx tailwindcss -i in.css -c tailwind.config.ts`): `tailwind.config.ts`에서 `import dsPreset from "./design-system/tailwind.preset"` + `presets: [dsPreset]`, 프리셋 `theme.extend.{colors: { ds: { "blue-400": … } }, spacing: { "ds-2": … }, borderRadius: { "ds-sm": … }, fontSize: { "ds-xs": … }}` → `.bg-ds-blue-400{background-color:var(--color-blue-400)}`, `.p-ds-2{padding:var(--space-2)}`, `.rounded-ds-sm{border-radius:var(--radius-sm)}`, `.text-ds-xs{font-size:var(--text-xs)}` 생성(`text-`의 색/크기 모호성은 Tailwind가 테마 조회로 풂). `.cjs` 프리셋을 `require`하는 `.cjs` config도 동일. TS config가 TS 프리셋을 import하는 것도 동작(Tailwind 3의 config 로더). **평탄 키**(`colors: { "ds-blue-400": … }`, `fontSize: { "ds-xs": … }`)도 TS·CJS 프리셋 모두 같은 4개 클래스를 생성(프로브로 확인 — 계획은 평탄 키를 쓴다). 주의(프로브에서 겪음): 확장자 없는 import(`./design-system/tailwind.preset`)는 같은 디렉터리에 `.cjs`와 `.ts`가 함께 있으면 `.cjs`를 먼저 집는다 → init은 프리셋 형식이 바뀌면 다른 형식의 옛 파일이 남아 있는지 경고한다(Task 3)
- v4 프로브(`tailwindcss@4.3.3` + `@tailwindcss/cli@4.3.3`): 진입 CSS `@import "tailwindcss"; @import "../design-system/tailwind.theme.css";`, 테마 파일 `@theme inline { --color-ds-blue-400: var(--color-blue-400); --spacing-ds-2: var(--space-2); --radius-ds-sm: var(--radius-sm); --text-ds-xs: var(--text-xs); }` → `.bg-ds-blue-400`, `.p-ds-2`, `.rounded-ds-sm`, `.text-ds-xs`, `.-mt-ds-2{margin-top:calc(var(--space-2) * -1)}` 생성. 네임스페이스 `--color-*`·`--spacing-*`·`--radius-*`·`--text-*`
- 임의값 타입 힌트(v3·v4 같은 결과): `bg-[color:var(--c)]`→background-color, `border-[color:var(--c)]`·`border-[var(--c)]`→border-color, `ring-[color:var(--c)]`→`--tw-ring-color`, `stroke-[color:var(--c)]`→stroke, `text-[length:var(--t)]`→font-size, `text-[color:var(--c)]`·`text-[var(--c)]`→color, `-mt-[var(--s)]`→`calc(var(--s) * -1)`, `p-[var(--s)]`, `rounded-[var(--r)]`
- **결정:** (1) 클래스 키는 `ds-` 접두 — 접두 없는 `bg-blue-400`·`p-2`는 Tailwind 기본 테마와 같은 이름이라 dsmith 추출기가 `tailwind-default`로 읽고(재추출 왕복 실패) 기본값을 조용히 덮는다. (2) 프리셋 값은 `var(--…)`로 `tokens.css`를 단일 출처로. (3) 임의값 경로는 색 `[color:…]`, 글꼴 크기 `[length:…]` 힌트를 항상 붙인다(속성이 재추출에서 보존되게). (4) v4는 `@theme inline`(변수 참조를 유틸리티에 그대로)
- 미확인: Tailwind 문서 페이지(presets, `@theme`) 원문 열람 안 함 — 위 빌드 결과가 근거. v4에서 `tokens.css`의 `:root { --color-blue-400; --radius-sm; --text-xs }`가 Tailwind 기본 테마 변수(같은 이름)를 덮어 `bg-blue-400`·`rounded-sm` 값이 바뀌는지 — 폴백: 4a는 다루지 않음, 컨트롤러 4에서 기록

### C.3 git 명령 — 확인(git 2.43.0 로컬 프로브)

- `git switch -c <name>`: 새 브랜치 생성·전환; 같은 이름이 있으면 `fatal: a branch named '<name>' already exists`(비 0). 존재 확인은 `git rev-parse --verify -q refs/heads/<name>`(있으면 sha 출력)
- `git diff --name-only --diff-filter=ACMR <base>...HEAD`: 세 점 = merge-base 기준 변경 파일(프로브: main 이후 추가한 파일만 나옴). `git merge-base <base> HEAD` → sha
- `git show <rev>:<path>`: 없는 경로면 `fatal: path '<path>' does not exist in '<rev>'`(비 0 — `runGit` ok:false를 "base에 없음"으로)
- 작성자: `git commit`은 레포/사용자 설정의 `user.name`·`user.email`을 쓴다. 설정이 없으면 "Author identity unknown"으로 실패. **사전 확인은 `git var GIT_AUTHOR_IDENT`**(설정 없으면 `fatal: unable to auto-detect email address`, exit 128). dsmith는 `--author`를 넘기지 않는다
- `git switch`는 git 2.23+ — 더 낮으면 `checkBranch`가 `git switch -h` 실패로 "git 2.23 이상 필요"를 낸다

### C.4 GitHub REST 코멘트·Actions — 확인(문서)

- 출처: https://docs.github.com/enterprise-server@3.21/rest/issues/comments (GHES 3.21 판 — github.com REST와 같은 엔드포인트; 이 세션에서 github.com 판 URL은 검색 결과에 없어 GHES 판으로 확인)
  - 목록 `GET /repos/{owner}/{repo}/issues/{issue_number}/comments`, `per_page` 최대 100(기본 30), `page`(기본 1)
  - 생성 `POST /repos/{owner}/{repo}/issues/{issue_number}/comments`, body `{ "body": string }`(필수)
  - 수정 `PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}`, body `{ "body": string }`
  - "Every pull request is an issue, but not every issue is a pull request." → PR 번호를 issue_number로 쓴다
  - 권한: fine-grained 토큰은 "Issues" 또는 "Pull requests" 쓰기 중 하나 → 워크플로 `permissions: { contents: read, pull-requests: write }`
- `actions/checkout` README(https://github.com/actions/checkout/): `fetch-depth` 기본 1, "0 indicates all history for all branches and tags" → `origin/<base_ref>` 비교에 `fetch-depth: 0` 필요. 현재 최신 메이저는 v7이지만 템플릿은 **이 레포 CI와 같은 `@v4`**(`.github/workflows/ci.yml`)로 고정 — 올릴 때 레포 CI와 함께
- 미확인: `GITHUB_EVENT_PATH`·`GITHUB_REPOSITORY`·`GITHUB_API_URL` 기본 환경 변수 이름(Actions 관용 — 문서 원문 미열람), 포크 PR에서 `GITHUB_TOKEN`이 읽기 전용이라 코멘트가 403이 되는 동작. 폴백: env가 없거나 HTTP 오류면 `comment.status "failed"`, 종료 코드 불변. 실제 PR 확인은 컨트롤러 5

### C.5 텍스트 패치와 검증 — 확인(코드 읽기)

- `@babel/generator`를 쓰지 않는다. 모든 치환은 Extractor `write`가 주는 `{ start, end, replacement }` 원문 구간 패치이고, 컴포넌트 편집도 Babel AST 노드의 `start`·`end`로 만든 텍스트 패치다(서식·주석 보존)
- 재파싱 검증은 기존 함수 재사용: `packages/core/src/parse/tsx.ts`의 `parseTsx`는 `errorRecovery: true`라 복구 가능한 오류에서 던지지 않고 `ast.errors`에 모은다 → **"오류 수가 늘지 않음"**으로 판정. `packages/core/src/parse/css-text.ts`의 `parseCssDeclarations`는 던지지 않는다 → **선언 수 동일 + 괄호 균형 불변**으로 판정
- 구문 검증만으로는 의미 손상(예: 따옴표 위치 오류로 문자열이 늘어남)을 못 잡으므로 apply는 **재추출 검증**(같은 Extractor로 다시 읽어 hardcoded −k, token +k, dynamic 불변)을 함께 한다 — conformance write 왕복과 같은 기준
