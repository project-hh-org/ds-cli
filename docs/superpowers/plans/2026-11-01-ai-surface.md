# Plan 3a: AI 표면 (install · MCP 서버 · 슬래시 명령) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 상태 0·1·2 어느 레포에서든 audit 인덱스만으로 동작하는 MCP 서버(도구 6개·리소스 2개)와 `dsmith install`(도구 감지 → 슬래시 명령 + MCP 등록을 레포에 안전하게 내려쓰기), `dsmith decide`(결정 기록)를 낸다. 3b(`init`·`ai`·카탈로그)가 붙을 자리는 타입과 분기만 남긴다.

**Architecture:** 판단 로직은 전부 core에 새 모듈로 둔다 — `component/`(집계·정의 파일·props·검색), `tokens/`(토큰 파일·제안 토큰·순위 매칭), `decisions/`(모델·저장·결정 카드·git 이력), `fs/safe-write.ts`. `packages/mcp-server`는 SDK 결합부(`server.ts`) 하나와 core 함수를 부르는 얇은 핸들러 6개 + 응답 토큰 상한(`budget.ts`)뿐이다. `packages/agent-skill`은 도구 중립 명령 소스 8개와 도구별 렌더러 5개(파일 하나씩)다. CLI가 둘 다 의존하고 `install`·`mcp`·`decide` 서브커맨드로 노출한다. mcp-server는 cli를 import하지 않는다 — 인덱싱(`runAudit`)과 Extractor 목록은 CLI가 주입한다.

**Tech Stack:** 기존(TS 5.7 NodeNext, pnpm, vitest, @babel/parser, culori, fast-glob, picomatch, commander) + `@modelcontextprotocol/server@^2.4.0`·`@modelcontextprotocol/client@^2.4.0`(테스트) + `zod@^4.2.0` + `diff@^9.0.0`(dry-run diff) + `yaml@^2.9.0`(명령 frontmatter). 근거는 부록 A.

**Spec:** `docs/superpowers/specs/2026-11-01-ai-surface-and-init-design.md` (main 1e41715) — §1 전체, §3 공통 결정. §2(3b)는 이 계획 범위 밖.

## Global Constraints

- 패키지 스코프 `@dsmith-dev/*`, CLI 패키지 `dsmith`; ESM only; `tsconfig.base.json` 상속(`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). zod의 `.optional()` 인자는 `T | undefined`로 들어오므로 핸들러 입력 타입은 `?: T | undefined`로 받는다
- 의존 방향: `core` ← `detect` ← `mcp-server` / `agent-skill`(core만) ← `cli`. **core는 CLI·MCP·SDK를 모른다.** mcp-server는 cli를 import하지 않는다(순환 금지) — `ensureIndex`·`extractors`를 주입받는다. Extractor 패키지는 mcp-server의 devDependency(테스트 전용)로만 허용
- MCP SDK import는 `packages/mcp-server/src/server.ts` 한 파일에만 둔다(부록 A의 v1 폴백이 필요해지면 이 파일만 고친다). zod는 SDK 문서대로 `import * as z from "zod/v4"`
- `dsmith mcp`는 stdout에 JSON-RPC 외 아무것도 쓰지 않는다. mcp-server 패키지에서 `console.log`·`process.stdout.write` 금지(로그는 stderr)
- 대상 레포에 쓰는 파일: `.dsmith/` 아래(기존) + `install`이 내려쓰는 파일. 후자는 **반드시 core `safeWrite`를 거친다**(직접 `fs.writeFile` 금지)
- 새 패키지는 `packages/extractor-css`의 `package.json`·`tsconfig.json`·`README.md`를 그대로 본떠 만든다(그 시점의 `version`·`license`·`author`·`repository.directory`·`publishConfig`·`files`·`engines`·`sideEffects` 포함). 루트 `tsconfig.json` `references`에 추가. vitest workspace는 `packages/*` 글롭이라 추가 작업 없음
- 커밋: 한국어 conventional prefix, Co-Authored-By 없음, author `dahee <dahee@project-hh.com>`(preconfigured). 각 커밋에서 루트 `pnpm -r build && pnpm test && pnpm typecheck` 녹색
- 기존 e2e 스냅샷(`packages/cli/test/__snapshots__`)은 이 계획에서 바뀌면 안 된다. 바뀌면 원인을 보고서에 적고 멈춘다
- **테스트는 fixture를 임시 디렉터리로 복사해서 쓴다**(`fs.cpSync(src, tmp, { recursive: true })`). e2e가 같은 fixture의 `.dsmith/`를 병렬로 지우므로 fixture 안에 쓰면 경합한다
- 외부 도구 파일 규약은 부록 A가 정본이다. 렌더러 파일 상단 주석에 부록 A의 확인 날짜·URL을 그대로 옮긴다(스펙 §1.1 "각 도구의 현재 파일 규약")

## Review Focus

1. MCP 핸들러가 얇은가 — 각 `tools/*.ts`는 입력 정규화 → core 함수 호출 → 출력 조립만(≈60줄 이하). 같은 로직이 CLI `decide`와 MCP에 따로 있으면 안 됨 → Task 3·6 코드
2. 응답 토큰 상한이 **모든** 도구에서 지켜지는가(목록형은 커서, 객체형은 축약 + `omitted`) → Task 5 budget 테스트, Task 6 합성 워크스페이스 테스트
3. `safeWrite` — 사용자가 고친 영역은 `--force` 없이 절대 덮어쓰지 않음, `dryRun`은 파일시스템 무변경(매니페스트 포함), 두 번째 실행은 매니페스트까지 바이트 동일 → Task 4, Task 8
4. git이 없거나 레포가 아니면 `history`가 생략되고 예외가 없음, git 호출에 타임아웃 → Task 3
5. `dsmith mcp` stdout 오염 없음(실제 stdio 클라이언트로 왕복) → Task 6 CLI 테스트
6. 렌더 결과가 부록 A 규약과 일치(스킬 `name` = 디렉터리 이름, agentskills 이름 규칙, Gemini `prompt` 필수, Cursor는 frontmatter 없는 마크다운) → Task 7 스냅샷

---

## File Structure

```
packages/core/src/component/summary.ts        summarizeComponents·duplicateNames·localDefinitionsOf·localDefinitionFiles (cli에서 이동)
packages/core/src/component/definition.ts     resolveDefinitionFile
packages/core/src/component/props.ts          readComponentProps (TS 타입에서 props)
packages/core/src/component/search.ts         searchComponents + COMPONENT_SYNONYMS
packages/core/src/tokens/css-variables.ts     readCssVariableTokens
packages/core/src/tokens/proposal.ts          proposalTokens (audit 클러스터 → 제안 토큰)
packages/core/src/tokens/load.ts              loadTokens, tokenCategoryOf
packages/core/src/match/token-matcher.ts      rankTokens 추가, matchToken은 rankTokens 위로
packages/core/src/decisions/{model,store,candidates,card,git-history,explain}.ts
packages/core/src/fs/safe-write.ts            safeWrite + 매니페스트
packages/detect/src/index.ts                  isDsSpecifier export
packages/mcp-server/                          새 패키지 @dsmith-dev/mcp-server
  src/{index,server,workspace,budget,resources}.ts
  src/tools/{resolve-token,lint-snippet,search-component,get-component,explain-decision,list-decisions}.ts
packages/agent-skill/                         새 패키지 @dsmith-dev/agent-skill
  commands/{ds,ds-detect,ds-audit,ds-decide,ds-check,ds-init,ds-ai,ds-migrate}.md
  src/{index,commands,detect-tools,mcp-launch}.ts
  src/renderers/{shared,claude-code,codex,cursor,gemini,agents-md}.ts
packages/cli/src/commands/{decide,mcp,install}.ts
packages/cli/src/bin.ts                       decide·mcp·install 등록
README.md, packages/{mcp-server,agent-skill}/README.md, .changeset/ai-surface.md
```

**순서·의존:** T1 → T2 → T3 → T5 → T6 → T8 이 주 경로. T3은 T1(집계·정의 파일)을, T5는 T1·T2·T3(워크스페이스가 decisions·isDsSpecifier를 씀)을 쓴다. T4(safe-write)는 T1~T3과 병렬 가능, T7은 T4만 필요. 모든 커밋은 그 시점에 단독 출시 가능(새 서브커맨드는 해당 Task에서 완결).

---

### Task 1: core `component/` — 집계 이동, 정의 파일·props 추출, 의도 검색

**Files:**
- Create: `packages/core/src/component/{summary,definition,props,search}.ts`
- Modify: `packages/core/src/index.ts`, `packages/cli/src/commands/audit.ts`(`componentsOf`·`duplicatesOf`·`localDefinitionsOf`를 core 호출로 교체 — `AuditResult` 모양 불변)
- Test: `packages/core/test/component-{summary,definition,props,search}.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // summary.ts — cli audit.ts의 집계를 옮기고 props·files를 더한다
  export interface ComponentSummary {
    name: string;
    module: string;               // "" = import 없는 지역 사용
    importedFrom: string | null;  // 그룹에서 처음 본 값
    count: number;
    files: { file: string; count: number }[];   // count 내림차순, 같으면 file 오름차순
    props: string[];              // 사용처 props 합집합, 오름차순
  }
  export function summarizeComponents(usages: ComponentUsage[]): ComponentSummary[];
  // 키 name+module, 정렬은 현재 cli componentsOf와 동일(count desc → name → importedFrom → module)
  export function duplicateNames(summaries: ComponentSummary[]): string[];   // 현재 duplicatesOf의 names와 동일 순서
  export interface LocalDefinition { name: string; files: number }
  export function localDefinitionsOf(usages: ComponentUsage[], limit?: number): LocalDefinition[];   // 기본 20, 현재 규칙 그대로
  export function localDefinitionFiles(usages: ComponentUsage[], name: string): string[];          // declaredLocally 파일, 오름차순

  // definition.ts
  export const DEFINITION_EXTENSIONS: readonly string[];   // [".tsx", ".ts", ".jsx", ".js"]
  /** module(root 상대 경로, 확장자 없음)을 실제 파일로 푼다: `${m}${ext}` → `${m}/index${ext}`. 없으면(패키지 등) null. root 상대 POSIX 경로 반환 */
  export function resolveDefinitionFile(root: string, module: string): Promise<string | null>;

  // props.ts
  export interface PropInfo { name: string; type?: string; required?: boolean; values?: string[] }
  export interface ComponentProps { props: PropInfo[]; inherits: string[] }
  /** 파일 최상위의 `name` 컴포넌트 선언에서 첫 매개변수 타입을 읽는다. 타입을 못 찾으면 null */
  export function readComponentProps(code: string, file: string, name: string): ComponentProps | null;

  // search.ts
  export const COMPONENT_SYNONYMS: Readonly<Record<string, readonly string[]>>;
  export interface ComponentMatch { name: string; module: string; score: number; why: string; usageCount: number }
  export function searchComponents(summaries: ComponentSummary[], intent: string): ComponentMatch[];
  ```
  `readComponentProps` 규칙: 대상 선언 = `function X(p)`, `export default function X(p)`, `const X = (p) => …`, `const X = function (p) {…}`, `const X = forwardRef<E, P>((p, ref) => …)`(두 번째 타입 인자 P 우선, 없으면 내부 함수 첫 매개변수), `React.forwardRef`·`memo(…)` 한 겹. 매개변수 타입: `TSTypeLiteral` → 멤버; `TSTypeReference` → 같은 파일의 `interface`(본문 멤버, `extends` 각 항목은 소스 텍스트로 `inherits`) 또는 `type` 별칭(`TSTypeLiteral`이면 멤버, `TSIntersectionType`이면 리터럴 부분은 멤버·나머지는 `inherits`). 멤버 → `{ name, type: 소스 텍스트, required: !optional }`, 타입이 문자열 리터럴 유니온이면 `values`(선언 순서). 다른 파일의 타입·제네릭은 따라가지 않는다(3b 카탈로그 범위).
  `searchComponents` 규칙: 의도 문자열을 소문자·영숫자/한글 단위로 쪼개 용어 집합을 만들고, 한국어 용어는 `COMPONENT_SYNONYMS`의 한국어 키(아래)로 영어 용어를 더한다. 컴포넌트 이름은 camelCase/PascalCase/`.`로 쪼갠다. 점수: 이름 조각이 용어와 같음 +3(용어당 1회), 용어의 동의어 목록에 이름 전체가 있음 +2, props 중 용어를 포함하는 이름 +1. `score > 0`만, 정렬 `score desc → usageCount desc → name`. `why`는 맞은 근거를 `; `로 이은 한국어(`이름 'date' 일치; 동의어 date→DatePicker; props 'date'`). `module === ""`(지역 사용) 항목은 제외.
  `COMPONENT_SYNONYMS` 최소 항목: `date: [DatePicker, Calendar, DateInput]`, `select: [Select, Dropdown, Combobox, Autocomplete]`, `modal: [Modal, Dialog, Sheet, Drawer, Popup]`, `button: [Button, IconButton]`, `input: [Input, TextField, TextInput, Textarea]`, `table: [Table, DataTable, DataGrid]`, `badge: [Badge, Tag, Chip, StatusBadge]`, `toast: [Toast, Snackbar, Alert, Notification]`, `tabs: [Tabs, Tab, SegmentedControl]`, `tooltip: [Tooltip, Popover]`, `checkbox: [Checkbox, Switch, Toggle]`, `card: [Card, Panel, KpiCard]`; 한국어 키 → 영어 용어: `날짜→date, 달력→date, 선택→select, 드롭다운→select, 모달→modal, 팝업→modal, 다이얼로그→modal, 버튼→button, 입력→input, 표→table, 테이블→table, 배지→badge, 뱃지→badge, 태그→badge, 알림→toast, 토스트→toast, 탭→tabs, 툴팁→tooltip, 체크→checkbox, 카드→card`.

- [ ] **Step 1: 실패하는 테스트**
  - summary: 기존 cli `componentsOf`/`duplicatesOf`/`localDefinitionsOf` 테스트 케이스를 core로 옮겨 같은 결과; `props` 합집합(`<B variant/>`,`<B size/>` → `["size","variant"]`); `files` 정렬
  - definition: 임시 디렉터리 `src/a/Button.tsx`, `src/b/index.ts` → `resolveDefinitionFile(tmp,"src/a/Button")="src/a/Button.tsx"`, `("src/b")="src/b/index.ts"`, `("@mui/material")=null`
  - props(코드 문자열로): `function Button({ children }: { children: ReactNode })` → `[{name:"children",type:"ReactNode",required:true}]`; legacy-demo 패턴 `interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: keyof typeof variants; size?: keyof typeof sizes }` → props 2개 `required:false`, `inherits:["ButtonHTMLAttributes<HTMLButtonElement>"]`; `type Props = A & { variant?: "primary" | "secondary" | "danger"; size?: "sm" | "md" }` → `values` 두 개, `inherits:["A"]`; `forwardRef<HTMLButtonElement, P>` → P 멤버; 타입 없는 `function X(props)` → null; 이름이 다른 선언만 있으면 null
  - search: 요약 `[DatePicker(5), Calendar(2), Button(9), Select(3)]`에 `"날짜 고르는 입력"` → 첫 결과 `DatePicker`, `Calendar` 포함, `Button` 없음; `"dropdown"` → `Select`(동의어); `why` 문자열 단언; 지역 사용(module "") 제외
- [ ] **Step 2: 실패 확인** — `pnpm --filter @dsmith-dev/core test` FAIL
- [ ] **Step 3: 구현** — summary는 cli 코드를 옮기고 cli는 import로 교체(`componentsOf = summarizeComponents(...).map(({name, importedFrom, module, count}) => ({name, importedFrom, module, count}))`). props는 `parseTsx` + 최상위 `program.body` 순회(traverse 불필요)
- [ ] **Step 4: 통과 확인** — `pnpm -r build && pnpm test && pnpm typecheck`; **e2e 스냅샷 불변**(legacy-demo 점수 52, duplicates Button·Badge)
- [ ] **Step 5: Commit** — 두 개: `refactor(core,cli): 컴포넌트 집계·중복·지역 재정의 판정을 core로 이동` / `feat(core): 컴포넌트 정의 파일·props 추출과 의도 검색`

---

### Task 2: core `tokens/` — 토큰 파일(CSS 변수)·제안 토큰·순위 매칭

**Files:**
- Create: `packages/core/src/tokens/{css-variables,proposal,load}.ts`
- Modify: `packages/core/src/match/token-matcher.ts`, `packages/core/src/index.ts`
- Test: `packages/core/test/tokens.test.ts`, `packages/core/test/token-matcher.test.ts`(추가)

**Interfaces:**
- Consumes: `parseCssDeclarations`, `normalizeColor`, `normalizeLength`, `clusterColors`, `clusterSpacing`, `Token`
- Produces:
  ```ts
  // token-matcher.ts
  export interface RankedToken { token: Token; distance: number; confidence: TokenMatch["confidence"] }
  export function rankTokens(
    normalized: StyleUsage["normalized"],
    tokens: Token[],
    opts?: { category?: Token["category"]; limit?: number },   // limit 기본 4
  ): RankedToken[];     // 거리 오름차순, 같으면 입력 순서. 기존 신뢰도 임계값 그대로
  // matchToken(normalized, tokens) = rankTokens(normalized, tokens, { limit: 1 })[0] ?? null  (동작 불변)

  // tokens/load.ts
  export type TokenSourceKind = "token-file" | "proposal" | "catalog";   // "catalog"는 3b가 채움
  export interface LoadedTokens {
    source: TokenSourceKind;
    tokens: Token[];
    files: string[];      // 실제로 읽은 토큰 파일
    ignored: string[];    // 3a가 읽지 않는 형식(.ts/.js/.json)이라 건너뛴 detect.ds.tokenFiles
  }
  export function tokenCategoryOf(property: StyleProperty): Token["category"] | null;
  // color|background-color|border-color|fill|stroke → color, padding|margin|gap|width|height → spacing, border-radius → radius, font-size → font-size, other → null
  export function loadTokens(root: string, tokenFiles: string[], styles: StyleUsage[]): Promise<LoadedTokens>;
  // tokenFiles 중 .css/.scss를 readCssVariableTokens로 읽어 토큰이 1개 이상이면 source "token-file",
  // 아니면 proposalTokens(styles)로 source "proposal". 3b 훅: .json(W3C)은 지금 ignored, 3b가 여기 분기를 추가

  // tokens/css-variables.ts
  export function readCssVariableTokens(code: string, file: string): Token[];
  // `--name: value` 선언(블록 무관, 파일 등장 순). 값이 `var(--x)` 하나면 같은 파일의 --x로 1단계 해석.
  // 색으로 정규화되면 category color; 길이면 이름에 radius|rounded → radius, font-size|text-|fs- → font-size, 그 외 spacing; 둘 다 아니면 버림.
  // Token.name은 `--` 포함 그대로(`--color-primary`), value는 원문 값

  // tokens/proposal.ts
  export function proposalTokens(styles: StyleUsage[]): Token[];
  // 색: clusterColors(styles) 순서대로 name = suggestedName(중복 시 -2, -3 …), value = representative.hex.
  // 간격: clusterSpacing(styles) 중 onScale만, name = `space-${px / 4}`, value = `${px}px`, category spacing
  ```
- [ ] **Step 1: 실패하는 테스트** — `readCssVariableTokens(":root{--color-primary:#3b82f6;--space-2:8px;--radius-md:6px;--text-sm:14px;--brand:var(--color-primary);--shadow:0 1px 2px #000}")` → 5개(`--shadow` 제외), `--brand`는 color `#3b82f6`, `--radius-md` radius, `--text-sm` font-size; `proposalTokens`: 근접 파랑 두 개 → 토큰 1개 `blue-…`, 같은 suggestedName 두 클러스터 → `-2` 접미, 간격 13px은 제외·8px은 `space-2`; `loadTokens`: 임시 디렉터리에 `tokens.css` → source `token-file`, `files` 1; `theme.ts`만 → source `proposal`, `ignored ["theme.ts"]`; `rankTokens`: 색 토큰 5개 중 limit 4·거리 오름차순, `category: "radius"`면 radius만; `matchToken` 기존 테스트 그대로 통과
- [ ] **Step 2: 실패 확인 → 구현 → 통과** — `pnpm -r build && pnpm test && pnpm typecheck`
- [ ] **Step 3: Commit** — `feat(core): 토큰 파일(CSS 변수)·audit 제안 토큰 로더와 순위 매칭`

---

### Task 3: core `decisions/` + CLI `decide`

**Files:**
- Create: `packages/core/src/decisions/{model,store,candidates,card,git-history,explain}.ts`
- Modify: `packages/core/src/index.ts`, `packages/detect/src/index.ts`(`export { isDsSpecifier } from "./detect-ds.js"`)
- Create: `packages/cli/src/commands/decide.ts`; Modify: `packages/cli/src/bin.ts`
- Test: `packages/core/test/decisions-{store,card,git}.test.ts`, `packages/cli/test/decide.test.ts`

**Interfaces:**
- Consumes: Task 1 `summarizeComponents`·`duplicateNames`·`localDefinitionsOf`·`localDefinitionFiles`·`resolveDefinitionFile`, `isRatedUsage`
- Produces:
  ```ts
  // model.ts
  export type DecisionKind = "duplicate" | "local-definition" | "token-cluster";   // token-cluster는 3b init이 기록
  export type Confidence = "high" | "medium" | "low";
  export interface GitHistory { firstCommit: { sha: string; date: string }; lastCommit: { sha: string; date: string }; authorsCount: number }
  export interface DecisionOption {
    id: string;                 // duplicate: module, local-definition: 정의 파일 경로 (안정적·사람이 읽는 값)
    label: string;              // duplicate: module, local-definition: file
    module?: string;            // duplicate만
    file?: string;              // 정의 파일(풀렸을 때). local-definition은 항상
    usageCount: number;
    files: string[];            // 사용 파일 상위 5 (count desc)
    props: string[];            // 사용처 props 합집합
    styleValues: { color: string[]; spacing: number[] };   // 정의 파일의 hardcoded 색 hex·간격 px, 중복 제거·정렬, 각 ≤10
    isDs: boolean;
  }
  export type DifferenceAspect = "module" | "props" | "color" | "spacing";
  export interface DecisionCard {
    item: string;
    kind: DecisionKind;
    options: DecisionOption[];  // usageCount desc → id asc
    differences: { aspect: DifferenceAspect; byOption: Record<string, string[]> }[];   // 옵션 사이 값이 다른 aspect만. byOption 값은 "그 옵션에만 있는 것"
    impact: { byOption: Record<string, { callSites: number; files: number }> };       // 그 옵션을 고르면 바꿔야 하는 다른 옵션들의 호출 수·파일 수
    ruleCheck: { tokenMatchRate: Record<string, number | null>; a11yNotes?: string[] }; // 정의 파일 rated 스타일 중 token 비율(소수 4자리), rated 0이면 null. a11yNotes는 3a에서 생략
    history?: { byOption: Record<string, GitHistory> };    // git 없거나 정의 파일 없으면 그 옵션 생략, 전부 없으면 필드 생략
    recommendation: { optionId: string; reason: string; confidence: Confidence; rule: "ds-module" | "usage" | "token-rate" | "tie" };
    decided?: { chosen: string; decidedAt: string; note?: string };
  }
  export interface DecisionRecord {
    item: string; kind: DecisionKind; status: "pending" | "decided";
    options: string[]; chosen?: string; note?: string; decidedAt?: string;
  }
  export interface DecisionsFile { version: 1; items: DecisionRecord[] }
  export interface DecisionListItem { item: string; kind: DecisionKind; options: string[]; status: "pending" | "decided"; decided?: string }

  // store.ts
  export function readDecisions(root: string): Promise<DecisionsFile>;      // 없으면 { version: 1, items: [] }; 깨진 JSON은 파일명 포함 에러
  export function writeDecisions(root: string, file: DecisionsFile): Promise<string>;   // .dsmith/decisions.json, 2칸 들여쓰기 + 개행
  export function recordDecision(file: DecisionsFile, record: DecisionRecord): DecisionsFile;   // (item, kind) 기준 upsert, 순수

  // candidates.ts
  export interface DecisionCandidate { item: string; kind: DecisionKind; optionIds: string[] }
  export function decisionCandidates(index: Index): DecisionCandidate[];   // duplicateNames 순 → localDefinitionsOf 순
  export function listDecisions(index: Index, file: DecisionsFile, status?: "pending" | "decided"): DecisionListItem[];
  // 후보 + 파일에만 있는 기록(예: 3b token-cluster)을 합친다. 기록이 decided면 status decided·decided=chosen

  // git-history.ts
  export function readGitHistory(root: string, file: string, opts?: { timeoutMs?: number }): Promise<GitHistory | null>;
  // execFile("git", ["log", "--follow", "--format=%H%x09%aI%x09%ae", "--", file], { cwd: root, timeout: 5000 기본 })
  // 실패(ENOENT·레포 아님·타임아웃)·빈 출력 → null. 첫 줄 = lastCommit, 끝 줄 = firstCommit, sha 7자, authorsCount = 고유 이메일 수

  // card.ts (순수)
  export interface CardInput {
    candidate: DecisionCandidate;
    index: Index;
    isDsModule: (module: string) => boolean;
    definitionFiles: Record<string, string | null>;   // option id → 정의 파일
    history: Record<string, GitHistory>;              // 정의 파일 → 이력 (없는 키는 생략)
    record?: DecisionRecord;
  }
  export function buildDecisionCard(input: CardInput): DecisionCard;

  // explain.ts (비동기 조립)
  export interface ExplainOptions { isDsModule: (module: string) => boolean; decisions?: DecisionsFile; git?: boolean }   // git 기본 true
  export type ExplainResult = { card: DecisionCard } | { error: "not-found"; candidates: string[] };   // candidates = 이름이 item을 포함하거나 item이 이름을 포함하는 후보 ≤5
  export function explainDecision(root: string, index: Index, item: string, opts: ExplainOptions): Promise<ExplainResult>;
  ```
  추천 규칙(스펙 §1.3): (1) `isDs` 옵션이 정확히 1개 → 그것, `rule "ds-module"`, `high`, reason `"DS 모듈(<module>)에서 온 옵션"`; 2개 이상이면 그 옵션들로 좁혀 다음 규칙 (2) usageCount 최댓값이 유일 → `"usage"`, `medium`, `"사용 수 <n>회로 가장 많음"` (3) tokenMatchRate(null 제외) 최댓값이 유일 → `"token-rate"`, `low`, `"토큰 일치율 <p>%로 가장 높음"` (4) 그 외 → 정렬상 첫 옵션, `"tie"`, `low`, `"근거가 동률 — 사람이 판단"`.
  local-definition 옵션: 정의 파일마다 1개, usageCount = 그 파일 안의 같은 이름 사용 수, `isDs` = 파일이 DS 모듈 경로 아래인지(`isDsModule(file 확장자 제거)`).

  CLI (`decide.ts`):
  ```ts
  export function runDecideList(root: string, status?: "pending" | "decided"): Promise<DecisionListItem[]>;
  export function runDecideExplain(root: string, item: string, opts?: { git?: boolean }): Promise<ExplainResult>;
  export function runDecideChoose(root: string, item: string, optionId: string, note?: string): Promise<DecisionRecord>;
  // 셋 다 .dsmith/index.json·detect.json이 없으면 Error("먼저 dsmith audit을 실행하세요"). isDsModule = m => isDsSpecifier(m, detect.ds)
  // choose: optionId가 카드 options에 없으면 Error(`선택지 아님: <id>. 가능: <ids>`). decidedAt = new Date().toISOString()
  ```
  `bin.ts`: `dsmith decide (--list [--status <s>] | --explain <item> [--no-git] | --item <name> --choose <id> [--note <text>]) [--root] [--json]` — 셋 중 정확히 하나가 아니면 에러. 사람용 출력: list는 `pending N건 / decided M건` + 항목 한 줄씩, explain은 옵션·추천 한 줄씩, choose는 `결정 기록: <item> → <id> (.dsmith/decisions.json)`.

- [ ] **Step 1: 실패하는 테스트**
  - store: 없는 파일 → 빈 파일; upsert 두 번 → 1건; 깨진 JSON → 메시지에 `.dsmith/decisions.json`
  - git: `git init` + `-c user.name=t -c user.email=t@t commit` 두 번(작성자 2명)한 임시 레포 → `authorsCount 2`, first≠last; git 없는 임시 디렉터리 → null(예외 없음); 존재하지 않는 파일 → null
  - card(순수, 합성 Index): DS 옵션 1개 → `ds-module/high`; DS 없음·사용 3 vs 1 → `usage/medium`; 사용 동률·토큰율 0.5 vs null → `token-rate/low`; 전부 동률 → `tie/low`; `impact`: A(3회·2파일), B(1회·1파일) → `impact.byOption.A = {callSites:1, files:1}`; props 차이 `{aspect:"props", byOption:{B:["onClick"]}}`; history 빈 맵 → 필드 없음
  - explain(fixture 복사본 `with-ds-app`, audit 실행 후, `git:false`): `"Button"` → 옵션 2개(`components/ui/Button`, `src/legacy/Button`), 추천 `components/ui/Button`·`ds-module`·`high`, `history` 없음; `"Butto"` → `not-found`, candidates `["Button"]`
  - explain(fixture 복사본 `legacy-demo`): `"Button"` → 추천 `src/components/ui/button`(DS), `differences`에 props aspect로 `src/components/Button: ["onClick"]`; `"Badge"` → `confidence "low"`
  - cli decide: list → pending 2건(Button, Badge); choose `Badge`·`src/components/Badge` → decisions.json 기록, 다시 list → decided 1·pending 1; 잘못된 id → 에러 메시지에 가능한 id; index 없음 → "먼저 dsmith audit"
- [ ] **Step 2: 실패 확인 → 구현 → 통과** — `pnpm -r build && pnpm test && pnpm typecheck`
- [ ] **Step 3: Commit** — 두 개: `feat(core): 결정 카드 모델·decisions.json·git 이력` / `feat(cli): decide 서브커맨드 (--list·--explain·--choose)`

---

### Task 4: core `fs/safe-write.ts`

**Files:**
- Create: `packages/core/src/fs/safe-write.ts`; Modify: `packages/core/src/index.ts`, `packages/core/package.json`(`diff@^9.0.0`)
- Test: `packages/core/test/safe-write.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ManagedRegion =
    | { kind: "file" }                                   // 파일 전체가 dsmith 소유(전용 경로)
    | { kind: "block"; start: string; end: string }      // 마커 줄 사이(마커 줄 제외)
    | { kind: "json-key"; keyPath: string[] };           // JSON 파일의 한 키 값
  export interface PlannedWrite {
    file: string;            // 절대 경로
    region: ManagedRegion;
    content: string;         // file/block: 텍스트(끝 개행 하나로 정규화), json-key: JSON.stringify(value)
  }
  export type WriteStatus = "created" | "updated" | "unchanged" | "skipped-modified" | "skipped-unowned" | "skipped-invalid";
  export interface WriteOutcome {
    file: string;            // displayRoot 상대(밖이면 `~/` 또는 절대)
    region: ManagedRegion["kind"];
    status: WriteStatus;
    diff?: string;           // dryRun이거나 skipped-*일 때 현재 → 원하는 내용의 unified diff
    reason?: string;
  }
  export interface SafeWriteOptions {
    manifestFile: string;    // 절대 경로. install: <root>/.dsmith/install.json (--global: ~/.dsmith/install.json)
    displayRoot: string;
    home?: string;           // 표시용 `~/` 치환
    dryRun?: boolean;
    force?: boolean;
    tool: string;            // 매니페스트 tool 필드 ("install" | 3b "init" | "ai")
    version: string;         // dsmith 버전 (매니페스트 기록용)
  }
  export interface SafeWriteResult { outcomes: WriteOutcome[]; applied: boolean; manifestChanged: boolean }
  export interface WriteManifest {
    version: 1; tool: string; dsmith: string;
    entries: Record<string, { sha256: string }>;   // 키 = regionKey
  }
  export function regionKey(w: PlannedWrite, displayRoot: string): string;
  // `<rel>` | `<rel>#block:<start>` | `<rel>#json:<keyPath.join(".")>`
  export function safeWrite(writes: PlannedWrite[], opts: SafeWriteOptions): Promise<SafeWriteResult>;
  ```
  판정(영역마다, `current` = 현재 영역 텍스트, `desired` = content, `recorded` = 매니페스트 해시):
  | 상황 | 결과 |
  | --- | --- |
  | 영역 없음(파일 없음 / 마커 없음 / 키 없음) | `created` — file: 새로 씀, block: 파일 끝에 `\n<start>\n<content><end>\n` 추가(파일 없으면 블록만), json-key: 객체 경로 생성 |
  | `current === desired` | `unchanged`, 매니페스트에 없으면 등록(채택) |
  | `recorded === sha(current)` | `updated` |
  | `recorded` 있음 ≠ `sha(current)` | `skipped-modified`(사용자 수정) — `force`면 `updated` |
  | `recorded` 없음, `current ≠ desired` | `skipped-unowned`(dsmith가 쓴 적 없음) — `force`면 `updated` |
  | JSON 파싱 실패 / 마커 짝 안 맞음 | `skipped-invalid` + reason, `force`여도 쓰지 않음 |
  - json-key 쓰기: 다른 키는 보존, 기존 들여쓰기 감지(첫 들여쓴 줄의 공백, 없으면 2칸), 끝 개행 1개. 비교는 `JSON.stringify(값)`(정규 형태)
  - block: 파일이 CRLF면 블록도 CRLF. 마커가 두 번 이상이면 `skipped-invalid`
  - `dryRun`: 파일·매니페스트 모두 쓰지 않음, `applied false`, 각 outcome에 diff(`createTwoFilesPatch(rel, rel, before, after, "", "", { context: 3 })`)
  - 매니페스트는 바뀐 엔트리가 있을 때만 다시 쓴다(키 정렬, 타임스탬프 없음) → 두 번째 실행이 바이트 동일

- [ ] **Step 1: 실패하는 테스트**(임시 디렉터리) — 각 표 행 1건씩; file 2회 실행 → 2회차 전부 `unchanged`, 매니페스트 mtime·내용 불변; 사용자가 SKILL.md 한 줄 수정 → `skipped-modified`, 파일 내용 그대로, `force` → `updated`; `.mcp.json`에 `{"mcpServers":{"other":{…}}}`(4칸 들여쓰기) → dsmith 키 추가 후 `other` 보존·4칸 유지; `.mcp.json`이 `{` → `skipped-invalid`; AGENTS.md 기존 본문 + 블록 → 블록만 갱신, 블록 밖 텍스트 바이트 동일; dryRun → 디렉터리 트리 해시(경로+내용) 전후 동일, diff에 `+` 줄 존재
- [ ] **Step 2: 실패 확인 → 구현 → 통과**
- [ ] **Step 3: Commit** — `feat(core): safe-write — 전용 파일·마커 블록·JSON 키 단위 쓰기와 해시 매니페스트`

---

### Task 5: `packages/mcp-server` 1 — 골격·워크스페이스·응답 상한·resolve_token·lint_snippet·search_component·리소스

**Files:**
- Create: `packages/mcp-server/{package.json,tsconfig.json,README.md}`(extractor-css 본뜸; `name "@dsmith-dev/mcp-server"`, `description "dsmith MCP server: design-system tools for AI agents"`)
- Create: `src/{index,server,workspace,budget,resources}.ts`, `src/tools/{resolve-token,lint-snippet,search-component}.ts`
- Modify: 루트 `tsconfig.json` references
- Test: `test/helpers.ts`, `test/budget.test.ts`, `test/tools-a.test.ts`

**Interfaces:**
- 의존성: `@dsmith-dev/core`, `@dsmith-dev/detect`, `@dsmith-dev/extractor-api`, `@modelcontextprotocol/server@^2.4.0`, `zod@^4.2.0`. devDependencies: `@modelcontextprotocol/client@^2.4.0`, `@dsmith-dev/extractor-{tailwind,inline-style,css,styled}`, `vitest`
- Produces:
  ```ts
  // index.ts
  export const TOOL_NAMES = ["resolve_token", "lint_snippet", "search_component", "get_component", "explain_decision", "list_decisions"] as const;
  export type ToolName = (typeof TOOL_NAMES)[number];
  export interface ServerDeps {
    root: string;                                   // 절대 경로
    version: string;                                // dsmith 버전 (serverInfo)
    extractors: Extractor[];                        // lint_snippet용 — CLI는 레지스트리 전부
    ensureIndex: (root: string) => Promise<void>;   // .dsmith/index.json 또는 detect.json이 없을 때 1회. CLI는 runAudit
    tokenBudget?: number;                           // 기본 DEFAULT_TOKEN_BUDGET
    git?: boolean;                                  // explain_decision의 git 이력. 기본 true
    log?: (line: string) => void;                   // 기본 stderr
  }
  export function createDsmithServer(deps: ServerDeps): Promise<McpServer>;   // server.ts
  export function startStdioServer(deps: ServerDeps): Promise<void>;          // server.ts — StdioServerTransport 연결, stderr에 "dsmith mcp: root=<root>"

  // workspace.ts
  export interface Workspace {
    root: string;
    detect: DetectResult;
    index: Index;
    components: ComponentSummary[];       // summarizeComponents(index.components)
    tokens: LoadedTokens;                 // loadTokens(root, detect.ds.tokenFiles, index.styles)
    decisions: DecisionsFile;
    isDsModule: (module: string) => boolean;
  }
  export interface WorkspaceHandle { get(): Promise<Workspace> }
  export function openWorkspace(deps: ServerDeps): Promise<WorkspaceHandle>;
  // 시작: detect.json·index.json 중 하나라도 없으면 deps.ensureIndex(root) 1회 후 읽음(그래도 없으면 Error).
  // 이후 get()마다 index.json·detect.json·decisions.json mtime을 stat해 바뀐 것만 다시 읽고 파생값 재계산.
  // 시작 시 deps.extractors 각각 prepare?.(root) 1회.

  // budget.ts
  export const DEFAULT_TOKEN_BUDGET = 1500;
  export function estimateTokens(text: string): number;   // ASCII 코드포인트 0.25, 그 외 1, 합을 올림
  export function toText(value: unknown): string;          // JSON.stringify(value) — compact
  export interface Page<T> { items: T[]; total: number; truncated: boolean; nextCursor?: string }
  export function paginate<T>(items: T[], cursor: string | undefined, budget: number, wrap: (page: Page<T>) => object): object;
  // cursor = 시작 오프셋 10진 문자열(잘못되면 throw → 도구 오류). 들어가는 만큼 탐욕적으로 담되 최소 1개. 남으면 truncated true + nextCursor
  export function shrinkToBudget<T extends object>(value: T, budget: number): T & { truncated?: true; omitted?: Record<string, number> };
  // 넘치면 가장 긴(직렬화 길이) 배열을 반으로 자르기를 반복; omitted["options.0.files"] = 잘린 개수. 배열이 더 없으면 그대로 truncated

  // tools/resolve-token.ts
  export interface ResolveTokenInput { raw: string; property?: string | undefined }
  export interface ResolveTokenOutput {
    input: { raw: string; property?: string };
    token?: { name: string; value: string };
    distance: number | null;               // 소수 4자리, 토큰 없음 → null
    confidence: "high" | "medium" | "low"; // exact→high, close→medium, far→low, 토큰 없음→low
    source: TokenSourceKind;
    alternatives: { name: string; value: string; distance: number }[];   // ≤3
    ignoredTokenFiles?: string[];
  }
  export function resolveToken(ws: Workspace, input: ResolveTokenInput): ResolveTokenOutput;
  // raw를 normalizeColor → 실패 시 normalizeLength({kind:"length"}). 둘 다 실패면 throw Error("값을 해석할 수 없음: <raw>").
  // property(kebab/camel)가 있으면 cssPropertyToStyleProperty → tokenCategoryOf로 rankTokens category 지정

  // tools/lint-snippet.ts
  export interface LintSnippetInput { code: string; filename?: string | undefined; cursor?: string | undefined }
  export interface Violation { line: number; column: number; property: StyleProperty; raw: string; suggestion?: { name: string; value: string; confidence: "high" | "medium" | "low" }; extractor: string }
  export interface LintSnippetOutput { violations: Violation[]; summary: { hardcoded: number; token: number; dynamic: number }; extractorsRun: string[] }
  export function lintSnippet(ws: Workspace, extractors: Extractor[], input: LintSnippetInput): LintSnippetOutput;
  // ctx = { root, file: filename ?? "snippet.tsx", code }. picomatch(e.files)(file) && e.appliesTo(ctx)인 Extractor만 extract.
  // 위반 = source "hardcoded" && isRatedUsage. 제안 = resolveToken(ws, {raw, property}) 의 token(있을 때). summary는 전체 usage 기준(tailwind-default는 어느 칸에도 안 셈)
  // Extractor 예외는 Error(`parse(<name>): <msg>`)로 다시 던짐

  // tools/search-component.ts
  export interface SearchComponentInput { intent: string; limit?: number | undefined; cursor?: string | undefined }
  export function searchComponent(ws: Workspace, input: SearchComponentInput): ComponentMatch[];   // searchComponents 결과를 limit(기본 10)으로 자름

  // resources.ts
  export function tokensList(ws: Workspace): { source: TokenSourceKind; names: string[] };
  export function componentsList(ws: Workspace): { source: "index"; components: { name: string; module: string }[] };   // module "" 제외, 사용 수 순
  ```
  `server.ts` 결합 규칙: 도구마다 `registerTool(name, { description, inputSchema: z.object({...}) }, handler)`. 핸들러 반환 `{ content: [{ type: "text", text: toText(out) }] }` — `structuredContent`는 쓰지 않는다(본문 중복으로 토큰 두 배). 목록형(search_component의 결과, lint_snippet의 violations, list_decisions)은 `paginate`, 객체형은 `shrinkToBudget`. 핸들러 예외 → `{ isError: true, content: [{ type: "text", text: message }] }`. 입력 스키마: `resolve_token {raw: z.string().min(1), property: z.string().optional()}`, `lint_snippet {code: z.string().max(100_000), filename: z.string().optional(), cursor: z.string().optional()}`, `search_component {intent: z.string().min(1), limit: z.number().int().min(1).max(50).optional(), cursor: z.string().optional()}`. 리소스: `registerResource("tokens", "tokens://list", { mimeType: "application/json" }, uri => ({ contents: [{ uri: uri.href, text: toText(tokensList(ws)) }] }))`, `components://list` 동일. description은 한 줄 영어 + 언제 쓰는지(예: `resolve_token`: "Map a raw style value (#3B82F6, 13px) to the closest design token with distance and confidence. Use before writing any hardcoded color or spacing.").

  테스트 헬퍼(`test/helpers.ts`):
  ```ts
  export function copyFixture(rel: string, overlay?: Record<string, string>): string;   // fixtures|examples/<name> → tmp, overlay 파일 추가
  export async function indexFixture(root: string): Promise<void>;   // indexRepo + detect(available: 4종 메타) + writeIndex/writeDetect (테스트용 ensureIndex)
  export async function connect(deps: Partial<ServerDeps> & { root: string }): Promise<Client>;   // InMemoryTransport.createLinkedPair()로 createDsmithServer와 Client 연결
  export function json(result: CallToolResult): any;   // content[0].text JSON.parse
  ```
  `with-ds-app` 토큰 overlay(원본 fixture는 수정하지 않음 — e2e 스냅샷 보존): `components/ui/tokens.css` = `:root {\n  --color-primary: #3b82f6;\n  --color-text: #111111;\n  --space-2: 8px;\n  --radius-md: 6px;\n}\n`

- [ ] **Step 1: 실패하는 테스트**
  - budget: `estimateTokens("abcd")=1`, `("abcde")=2`, `("가나다")=3`; `paginate` 1,000개 → 첫 페이지 `estimateTokens(toText(page)) ≤ 1500`, `nextCursor`를 따라가면 1,000개를 정확히 한 번씩; 아이템 하나가 상한보다 커도 1개는 담음; 잘못된 cursor → throw; `shrinkToBudget` 500개 배열 객체 → 상한 이하 + `omitted` 합 = 잘린 수
  - 인메모리 클라이언트(`listTools` → 6개 이름 전부 — 아직 없는 3개는 Task 6에서 등록하므로 이 Task에서는 3개만 단언)
  - `with-ds-app`+overlay: `resolve_token {raw:"#3B82F6"}` → `token.name "--color-primary"`, `confidence "high"`, `source "token-file"`; `{raw:"8px", property:"padding"}` → `--space-2`; `{raw:"6px", property:"border-radius"}` → `--radius-md`; `{raw:"nope"}` → `isError true`
  - `legacy-demo`: `resolve_token {raw:"#3B82F6"}` → `source "proposal"`, `token.value "#3b82f6"`, `ignoredTokenFiles ["src/lib/theme.ts"]`
  - lint_snippet(`with-ds-app`+overlay): Tailwind `export const A = () => <div className="text-[#3B82F6] p-[13px]" />` → 위반 2(`color`·`padding`), color 제안 `--color-primary`; inline `<div style={{ color: "#3B82F6", padding: 13 }} />` → 위반 2, `extractor "inline-style"`; styled `import styled from "styled-components";\nconst B = styled.button\`color: #3B82F6;\`` → 위반 1, `extractor "styled"`, `line 2`; 토큰만 쓴 스니펫 → 위반 0, `summary.token ≥ 1`
  - search_component(`legacy-demo`): `{intent:"버튼"}` → 결과에 `Button` 두 module 모두(`src/components/ui/button`, `src/components/Button`)와 `PrimaryButton`; `{intent:"표"}` → `Table` 첫 번째
  - 상한: 합성 워크스페이스(컴포넌트 `Button0…Button999`, 각 props 5개) `search_component {intent:"button", limit:50}` 응답 텍스트 `estimateTokens ≤ 1500`, `truncated true`
  - 리소스: `readResource({uri:"tokens://list"})` → `names`에 `--color-primary`; `components://list` → `Button` 2건
  - 시작 시 index 없음 → 주입한 `ensureIndex`가 정확히 1회 호출되고 그 뒤 도구가 동작; index.json을 다시 쓰면(mtime 변경) 다음 호출이 새 데이터를 봄
- [ ] **Step 2: 실패 확인 → 구현 → 통과** — `pnpm -r build && pnpm test && pnpm typecheck`
- [ ] **Step 3: Commit** — `feat(mcp-server): MCP 서버 골격과 resolve_token·lint_snippet·search_component, 응답 토큰 상한`

---

### Task 6: `packages/mcp-server` 2 — get_component·explain_decision·list_decisions + CLI `mcp`

**Files:**
- Create: `packages/mcp-server/src/tools/{get-component,explain-decision,list-decisions}.ts`; Modify: `src/server.ts`
- Create: `packages/cli/src/commands/mcp.ts`; Modify: `packages/cli/src/bin.ts`, `packages/cli/package.json`(`@dsmith-dev/mcp-server` 의존, devDependency `@modelcontextprotocol/client@^2.4.0`), `packages/cli/tsconfig.json` references
- Test: `packages/mcp-server/test/tools-b.test.ts`, `packages/cli/test/mcp.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // tools/get-component.ts
  export interface GetComponentInput { name: string; module?: string | undefined }
  export interface GetComponentOutput {
    name: string; module: string;
    props: PropInfo[];
    propsSource: "type" | "usage";       // 정의 파일 TS 타입에서 읽었으면 type, 아니면 사용처 props 이름만
    inherits?: string[];
    variants?: string[];                  // props 중 name "variant"의 values
    deprecated?: string;                  // 3b 카탈로그가 채움 (3a 생략)
    examples?: string[];                  // 3b (3a 생략)
    usage: { count: number; files: string[] };   // files ≤5
    definitionFile?: string;
    otherModules?: string[];              // 같은 이름의 다른 module (module 미지정 시)
    source: "index" | "catalog";          // 3a는 항상 "index"
  }
  export function getComponent(ws: Workspace, input: GetComponentInput): Promise<GetComponentOutput>;
  // name(+module) 일치 요약 중 사용 수 최대. 없으면 Error(`컴포넌트 없음: <name>`) + 비슷한 이름 ≤5를 메시지에
  // 정의 파일 = resolveDefinitionFile(root, module) → 있으면 readComponentProps(code, file, name)

  // tools/explain-decision.ts
  export function explainDecisionTool(ws: Workspace, input: { item: string }, opts: { git: boolean }): Promise<DecisionCard>;
  // core explainDecision 그대로. not-found → Error(`결정 항목 아님: <item>. 후보: <candidates>`)

  // tools/list-decisions.ts
  export function listDecisionsTool(ws: Workspace, input: { status?: "pending" | "decided" | undefined }): DecisionListItem[];   // core listDecisions

  // cli commands/mcp.ts
  export interface McpCommandOptions { root: string; budget?: number; git?: boolean }
  export function runMcp(opts: McpCommandOptions): Promise<void>;
  // startStdioServer({ root: path.resolve(opts.root), version: <cli package.json version>,
  //   extractors: buildExtractors(Object.keys(registry)), ensureIndex: async r => { await runAudit(r) }, tokenBudget, git })
  ```
  입력 스키마: `get_component {name: z.string().min(1), module: z.string().optional()}`, `explain_decision {item: z.string().min(1)}`, `list_decisions {status: z.enum(["pending","decided"]).optional(), cursor: z.string().optional()}`. `bin.ts`: `dsmith mcp [--root <dir>] [--budget <tokens>] [--no-git]` — `--json` 없음, 이 커맨드는 stdout에 아무것도 출력하지 않는다. root 기본값 = `process.cwd()`(AI 도구가 레포 루트에서 서버를 띄운다는 가정 — 컨트롤러 확인 항목 3).

- [ ] **Step 1: 실패하는 테스트**
  - `with-ds-app` 복사본(인메모리, `git:false`): `get_component {name:"Button"}` → module `src/legacy/Button`(사용 2 > 1), `propsSource "type"`, props `[{name:"children", type:"ReactNode", required:true}]`, `otherModules ["components/ui/Button"]`, `source "index"`; `{name:"Button", module:"components/ui/Button"}` → `usage.count 1`; `{name:"Nope"}` → `isError`
  - `legacy-demo` 복사본: `get_component {name:"Badge", module:"src/components/Badge"}` → `color.values ["blue","gray","red"]`; `{name:"Button", module:"src/components/Button"}` → `variants ["primary","secondary","danger"]`, `inherits` 1개
  - `explain_decision {item:"Button"}`(with-ds-app) → 옵션 2개·`recommendation.optionId "components/ui/Button"`·`confidence "high"`(스펙 §1.4); `{item:"없음"}` → `isError`
  - `list_decisions {}`(legacy-demo) → `[{item:"Button",kind:"duplicate",…,status:"pending"},{item:"Badge",…}]`; CLI `runDecideChoose`로 Badge 기록 후 같은 서버에 다시 호출 → Badge `status "decided"`(mtime 재로드)
  - 상한(모든 도구): 합성 워크스페이스(컴포넌트 1,000개·props 200개짜리 1개·중복 옵션 30개짜리 항목)에서 6개 도구 각각의 응답 `estimateTokens ≤ 1500`; get_component는 `omitted.props > 0`
  - cli `mcp.test.ts`(빌드된 `dist/bin.js`, 실제 stdio): `fixtures/with-ds-app` 복사본(.dsmith 없음)에 `StdioClientTransport({ command: process.execPath, args: [bin, "mcp", "--root", tmp, "--no-git"] })` → `listTools` 6개 이름 = `TOOL_NAMES`, `callTool explain_decision Button` 성공, 실행 후 `tmp/.dsmith/index.json` 존재(ensureIndex = runAudit), 서버 stderr에 `root=`; 프로토콜이 깨지지 않았다는 것 자체가 stdout 오염 없음의 증거
- [ ] **Step 2: 실패 확인 → 구현 → 통과** — `pnpm -r build && pnpm test && pnpm typecheck`
- [ ] **Step 3: Commit** — 두 개: `feat(mcp-server): get_component·explain_decision·list_decisions` / `feat(cli): mcp 서브커맨드 (stdio, 인덱스 없으면 audit 1회)`

---

### Task 7: `packages/agent-skill` — 명령 소스 8개, 로더, 렌더러 5종, AI 도구 감지

**Files:**
- Create: `packages/agent-skill/{package.json,tsconfig.json,README.md}`(extractor-css 본뜸; `name "@dsmith-dev/agent-skill"`, **`files: ["dist", "commands"]`**, 의존 `@dsmith-dev/core`, `yaml@^2.9.0`)
- Create: `commands/{ds,ds-detect,ds-audit,ds-decide,ds-check,ds-init,ds-ai,ds-migrate}.md`
- Create: `src/{index,commands,detect-tools,mcp-launch}.ts`, `src/renderers/{shared,claude-code,codex,cursor,gemini,agents-md}.ts`
- Modify: 루트 `tsconfig.json` references
- Test: `test/{commands,renderers,detect-tools,mcp-launch}.test.ts` + `test/__snapshots__/`

**Interfaces:**
- Consumes: `PlannedWrite`(Task 4)
- Produces:
  ```ts
  // commands.ts
  export interface CommandSource { name: string; description: string; args?: string; uses: string[]; body: string }
  export const COMMANDS_DIR: URL;     // new URL("../commands/", import.meta.url) — dist에서도 패키지 루트의 commands/를 가리킴
  export function loadCommands(dir?: URL): Promise<CommandSource[]>;   // 파일명 오름차순, 아래 검증 실패 시 파일명 포함 Error
  // 검증: name = 파일명(확장자 제외) = /^[a-z0-9]+(-[a-z0-9]+)*$/ ≤64자; description 1~1024자;
  // uses 각 항목 /^(cli|mcp):[a-z_-]+( --[a-z-]+)*$/; body 줄 수 ≤ 40; body 안 `{{args}}`는 0~1회

  // mcp-launch.ts
  export interface McpLaunch { command: string; args: string[] }
  export function defaultMcpLaunch(version: string): McpLaunch;
  // { command: "npx", args: ["-y", `dsmith@${range}`, "mcp"] }, range = major ≥ 1 ? `${major}` : `0.${minor}`  (0.2.0 → "dsmith@0.2")
  export function parseMcpCommand(value: string): McpLaunch;   // "node /abs/bin.js" → { command:"node", args:["/abs/bin.js","mcp"] } (공백 분리, 따옴표 미지원)

  // detect-tools.ts
  export type AiTool = "claude-code" | "codex" | "cursor" | "gemini" | "agents-md";
  export const AI_TOOLS: readonly AiTool[];
  export interface ToolDetection { tools: AiTool[]; evidence: Partial<Record<AiTool, string[]>>; defaulted: boolean }
  export function detectTools(root: string, home: string): Promise<ToolDetection>;
  // 레포: .claude/·CLAUDE.md → claude-code, .cursor/ → cursor, .gemini/ → gemini, .agents/·AGENTS.md·.codex/ → codex.
  // 홈: ~/.claude/ → claude-code, ~/.codex/ → codex, ~/.cursor/ → cursor, ~/.gemini/ → gemini.
  // 아무것도 없으면 ["claude-code","agents-md"], defaulted true. codex가 있으면 agents-md를 자동 추가(AGENTS.md 블록은 agents-md 렌더러만 쓴다)
  export function normalizeTools(tools: AiTool[]): AiTool[];   // codex ⇒ +agents-md, AI_TOOLS 순서로 정렬·중복 제거

  // renderers/shared.ts
  export interface RenderContext { root: string; home: string; scope: "repo" | "global"; mcp: McpLaunch }
  export interface RenderOutput { writes: PlannedWrite[]; notes: string[] }   // notes: 사람이 직접 할 일(예: Codex 신뢰 프로젝트, 글로벌 미지원)
  export interface Renderer {
    tool: AiTool;
    verified: { date: string; urls: string[] };   // 부록 A 그대로
    supportsGlobal: boolean;
    render(commands: CommandSource[], ctx: RenderContext): RenderOutput;
  }
  export const MANAGED_NOTICE = "dsmith install이 관리하는 파일입니다. 직접 고치면 다음 install이 덮어쓰지 않습니다(--force로 덮어씀).";
  export function substituteArgs(body: string, replacement: string): string;   // {{args}} 치환
  export const MD_MARKERS = { start: "<!-- dsmith:start -->", end: "<!-- dsmith:end -->" };
  export const TOML_MARKERS = { start: "# dsmith:start", end: "# dsmith:end" };
  export function mcpServerEntry(launch: McpLaunch, extra?: Record<string, unknown>): Record<string, unknown>;   // { ...extra, command, args }
  export const renderers: Record<AiTool, Renderer>;   // index.ts
  ```
  렌더 결과(부록 A 규약, `<n>` = 명령 name):
  | 도구 | repo | global | MCP | `{{args}}` 치환 |
  | --- | --- | --- | --- | --- |
  | claude-code | `.claude/skills/<n>/SKILL.md` (file) | `~/.claude/skills/<n>/SKILL.md` | repo: `.mcp.json` json-key `["mcpServers","dsmith"]` = `{command,args}`(type 생략 = stdio). global: MCP 미기록 + note `claude mcp add --scope user dsmith -- <command> <args…>` | `$ARGUMENTS` |
  | codex | `.agents/skills/<n>/SKILL.md` | `~/.agents/skills/<n>/SKILL.md` | repo: `.codex/config.toml` block(TOML_MARKERS) + note "Codex는 신뢰한 프로젝트에서만 .codex/config.toml을 읽음"; global: `~/.codex/config.toml` block | `사용자가 함께 준 인자` |
  | cursor | `.cursor/commands/<n>.md` | 미지원 → note | repo: `.cursor/mcp.json` json-key = `{type:"stdio",command,args}` | `명령 뒤에 적은 내용` |
  | gemini | `.gemini/commands/<n>.toml` | 미지원 → note | repo: `.gemini/settings.json` json-key `["mcpServers","dsmith"]` = `{command,args}` | `{{args}}` 그대로 |
  | agents-md | `AGENTS.md` block(MD_MARKERS) | 미지원 → note | 없음(블록 안에 MCP 도구 이름과 실행 명령 문장) | — |

  파일 모양:
  - SKILL.md(claude-code·codex 공통): `---\nname: <n>\ndescription: <yaml 문자열>\n[argument-hint: <args>  ← claude-code만, args 있을 때]\n---\n\n<!-- <MANAGED_NOTICE> -->\n\n<body>\n`. frontmatter는 `yaml`의 `stringify`로 만든다(따옴표·콜론 이스케이프). 버전 문자열은 넣지 않는다(패치 버전마다 diff가 생기지 않게 — 버전은 매니페스트에)
  - Cursor: `<!-- <MANAGED_NOTICE> -->\n# /<n>\n\n<description>\n\n<body>\n` (frontmatter 없음)
  - Gemini: `# <MANAGED_NOTICE>\ndescription = <JSON.stringify(description)>\nprompt = '''\n<body>\n'''\n` — body에 `'''`가 있으면 렌더 에러
  - Codex config 블록: `[mcp_servers.dsmith]\ncommand = "<command>"\nargs = [<JSON 문자열들>]\n`
  - AGENTS.md 블록(≤40줄): `## dsmith (디자인 시스템 도구)` → 한 줄 소개 → 표 `| 명령 | 하는 일 | 슬래시 없을 때 |` (8행; "슬래시 없을 때" = uses의 첫 `cli:` 항목 → `npx dsmith <cmd> [--flag] --json`, 없으면 "MCP 서버 필요" 또는 "아직 없음") → `MCP 서버 dsmith(<command> <args>) 도구: resolve_token, lint_snippet, search_component, get_component, explain_decision, list_decisions` → 규칙 3줄(JSON에 없는 숫자 금지 · 결정은 사람이 고른 뒤 `npx dsmith decide --item <이름> --choose <id>` · 하드코딩 전 `resolve_token`)

  명령 소스(스펙 §1.2, 본문 ≤40줄, 도구 중립 마크다운, 인자 자리는 `{{args}}`):
  | 파일 | uses | 본문 요지 |
  | --- | --- | --- |
  | `ds.md` | `cli:detect` | `npx dsmith detect --json {{args}}` → state·ds·activeExtractors 설명 후 확인. state 0: audit→decide→init→ai, 1: audit→decide→(migrate), 2: check. 각 단계 = 해당 `/ds-*` 명령과 같은 절차, 단계 끝마다 사람 확인. 아직 없는 단계(init·ai·migrate)에 닿으면 "아직 제공되지 않음(0.3.0 예정)"이라 말하고 멈춤 |
  | `ds-detect.md` | `cli:detect` | detect 결과 5항목 설명, 틀리면 `.dsmith/detect.json` `overrides` 예시 제시(직접 고치기 전 확인) |
  | `ds-audit.md` | `cli:audit` | 아래 전문 |
  | `ds-decide.md` | `cli:decide --list`, `mcp:list_decisions`, `mcp:explain_decision` | `list_decisions {status:"pending"}` → 항목마다 `explain_decision` → 카드 표(옵션별 사용 수·영향·토큰율·이력·추천) → 사람이 고름 → `npx dsmith decide --item <item> --choose <id>` → 다음. MCP 없으면 `npx dsmith decide --explain <item> --json` |
  | `ds-check.md` | `mcp:lint_snippet`, `mcp:resolve_token` | `{{args}}` 파일 또는 `git diff --name-only`의 스타일 파일을 `lint_snippet`으로 검사 → 위반별 제안 토큰으로 수정안(적용 전 확인). MCP 없으면 "`npx dsmith install` 후 AI 도구 재시작" 안내 |
  | `ds-init.md`·`ds-ai.md`·`ds-migrate.md` | `[]` | "아직 제공되지 않음" + 대신 할 수 있는 것(`/ds-audit`, `/ds-decide`) 2줄. 3b·Plan 4가 본문을 교체 |

  `ds-audit.md` 전문(이 형식을 다른 명령의 기준으로 삼는다):
  ```markdown
  ---
  name: ds-audit
  description: 이 레포의 하드코딩 스타일 값·중복 컴포넌트를 진단하고 결과를 설명한다. "DS 진단", "하드코딩 얼마나", "design system audit" 같은 요청에 쓴다.
  args: "[--root <dir>] [--exclude <glob>]"
  uses: ["cli:audit"]
  ---

  `npx dsmith audit --json {{args}}` 를 실행하고 stdout JSON을 읽는다. stderr의 힌트·경고도 그대로 전한다.

  이 순서로 설명한다:
  1. 건강 점수 `health.score`, 산식 `health.formula`, 평가한 값 수 `health.rated`
  2. 하드코딩 비율 `health.hardcodedShare`, DS import 비율 `health.dsImportShare` (백분율로)
  3. 색 클러스터 `hardcoded.colors` 상위 5개 — `suggestedName`, 대표값, 병합된 원값 수, `total`
  4. 간격 `hardcoded.spacing` 중 `onScale: false` 상위 5개
  5. 중복 `duplicates[].names`, 지역 재정의 `localDefinitions` 상위 5개
  6. 하드코딩이 많은 파일 `hardcoded.byFile` 상위 5개
  7. 리포트 파일 `.dsmith/reports/audit-<날짜>.md`

  규칙:
  - JSON에 없는 숫자는 말하지 않는다. 백분율 변환 외의 계산을 하지 않는다.
  - `health.rated`가 0이면 점수는 참고용이라고 먼저 말한다.
  - 끝에 다음 단계 하나만 제안한다: 중복이나 지역 재정의가 있으면 `/ds-decide`, 없으면 `/ds-check`.
  ```

- [ ] **Step 1: 실패하는 테스트**
  - commands: 8개 로드, 이름 집합 일치, 각 본문 ≤40줄; `name`과 파일명 불일치 → Error; `uses: ["cli:Audit"]` → Error
  - 렌더러: 고정 `RenderContext`(`root:"/r"`, `home:"/h"`, `mcp: defaultMcpLaunch("0.2.0")`)로 도구별 `writes`(경로·region·content) 스냅샷; claude-code SKILL.md에 `$ARGUMENTS`·`argument-hint`; codex SKILL.md엔 `argument-hint` 없음·frontmatter `name`=디렉터리명; Gemini toml은 `description =`·`prompt = '''` 포함, body에 `'''` 심은 명령 → Error; Cursor 첫 줄이 `---`가 아님; 모든 SKILL.md `name`이 agentskills 규칙 정규식 통과; agents-md 블록 ≤40줄·8개 명령 행; global scope에서 cursor·gemini·agents-md는 `writes []` + note 1개
  - detect-tools: 임시 root/home에 흔적 조합 → 기대 도구; 빈 root/home → `["claude-code","agents-md"]`, `defaulted true`; `.agents/`만 → `["codex","agents-md"]`
  - mcp-launch: `"0.2.0"` → `dsmith@0.2`, `"1.4.2"` → `dsmith@1`; `parseMcpCommand("node /x/bin.js")`
- [ ] **Step 2: 실패 확인 → 구현 → 통과** — `pnpm -r build && pnpm test && pnpm typecheck`; `pnpm --filter @dsmith-dev/agent-skill exec npm pack --dry-run`에 `commands/*.md` 8개 포함
- [ ] **Step 3: Commit** — 두 개: `feat(agent-skill): 슬래시 명령 소스 8개와 로더` / `feat(agent-skill): 도구별 렌더러 5종과 AI 도구 감지`

---

### Task 8: CLI `install` + e2e + README + changeset

**Files:**
- Create: `packages/cli/src/commands/install.ts`; Modify: `packages/cli/src/bin.ts`, `packages/cli/package.json`(`@dsmith-dev/agent-skill`), `packages/cli/tsconfig.json`
- Test: `packages/cli/test/install.test.ts`, `packages/cli/test/e2e.test.ts`(추가 1건), `packages/cli/test/cli.test.ts`(명령·도구 이름 일관성 1건)
- Modify: `README.md`; Create: `.changeset/ai-surface.md`(`.changeset/`이 main에 있을 때만 — Plan 2.5 산출물)

**Interfaces:**
- Consumes: `safeWrite`(Task 4), `loadCommands`·`renderers`·`detectTools`·`normalizeTools`·`defaultMcpLaunch`·`parseMcpCommand`(Task 7), `TOOL_NAMES`(Task 5)
- Produces:
  ```ts
  export interface InstallOptions {
    root: string;
    home?: string;            // 기본 os.homedir() — 테스트가 주입
    tools?: AiTool[];         // --tool (반복 가능). 주면 감지 생략
    all?: boolean;            // --all = AI_TOOLS 전부
    global?: boolean;
    dryRun?: boolean;
    force?: boolean;
    mcpCommand?: string;      // --mcp-command "<cmd> [args…]" (배포 전 로컬 개발용)
  }
  export interface InstallResult {
    scope: "repo" | "global";
    tools: AiTool[];
    detection: ToolDetection | null;   // --tool/--all이면 null
    mcp: McpLaunch;
    outcomes: WriteOutcome[];
    notes: string[];
    manifest: string;                  // 표시용 경로
    dryRun: boolean;
  }
  export function runInstall(opts: InstallOptions): Promise<InstallResult>;
  export function formatInstallSummary(r: InstallResult): string;
  // "등록: claude-code, agents-md (감지: .claude/, CLAUDE.md)\n파일: 생성 9 · 변경 0 · 유지 0 · 건너뜀 0\n다음: AI 도구를 다시 열고 /ds 로 시작"
  // + dryRun이면 "(dry-run — 아무것도 쓰지 않음)" 머리줄과 outcome별 diff
  // + 건너뜀이 있으면 파일별 사유와 "--force로 덮어쓰기" 안내, notes는 "할 일:" 아래 한 줄씩
  ```
  절차: 도구 결정(`--all` > `--tool` > `detectTools`) → `normalizeTools` → `loadCommands()` → 도구별 `renderers[t].render(commands, ctx)`(global이면 `supportsGlobal` 아닌 도구는 note만) → `safeWrite(writes, { manifestFile: scope==="repo" ? <root>/.dsmith/install.json : <home>/.dsmith/install.json, displayRoot: root, home, dryRun, force, tool: "install", version })`. `version` = cli `package.json` version(`createRequire(import.meta.url)("../package.json")`), MCP 기본값 = `defaultMcpLaunch(version)`, `--mcp-command`가 있으면 `parseMcpCommand`. `--tool` 값은 `AI_TOOLS` 외면 에러. `bin.ts`: `dsmith install [--root] [--tool <name...>] [--all] [--global] [--dry-run] [--force] [--mcp-command <cmd>] [--json]`. `--json`은 `InstallResult` 그대로.

- [ ] **Step 1: 실패하는 테스트**(`install.test.ts`, 임시 root·home)
  - 흔적 없음 → claude-code + agents-md; 산출 파일 목록 스냅샷(SKILL.md 8개 + `.mcp.json` + `AGENTS.md` + `.dsmith/install.json`); `.mcp.json` = `{"mcpServers":{"dsmith":{"command":"npx","args":["-y","dsmith@0.<minor>","mcp"]}}}`(현재 cli 버전 기준으로 계산해 단언)
  - 2회 실행 → 2회차 outcome 전부 `unchanged`, 트리 해시(경로+내용, 매니페스트 포함) 동일
  - `--dry-run` → 트리 해시 실행 전후 동일, outcome에 diff
  - 사용자가 `.claude/skills/ds-audit/SKILL.md` 수정 → 재실행 시 그 파일만 `skipped-modified`, 내용 보존, 나머지 `unchanged`; `--force` → `updated`
  - 기존 `.mcp.json`에 다른 서버 → 보존; 기존 `AGENTS.md` 본문 → 블록 밖 바이트 동일
  - `--all` → 5개 도구 파일 전부 생성(`.cursor/commands/ds.md`, `.gemini/commands/ds.toml`, `.agents/skills/ds/SKILL.md`, `.codex/config.toml`), notes에 Codex 신뢰 프로젝트 안내
  - `--global --tool claude-code` → `<home>/.claude/skills/ds-audit/SKILL.md` 생성, root에는 아무것도 생기지 않음, note에 `claude mcp add --scope user`
  - `--mcp-command "node /x/bin.js"` → `.mcp.json` command `node`, args `["/x/bin.js","mcp"]`
  - `--tool vscode` → 에러
- [ ] **Step 2: 일관성 테스트**(`cli.test.ts`) — `loadCommands()`의 모든 `mcp:<x>` ⊆ `TOOL_NAMES`, 모든 `cli:<x>`의 서브커맨드 ⊆ `program.commands` 이름(`detect, audit, decide, mcp, install`), 플래그(`--list`)는 그 커맨드의 옵션에 있음
- [ ] **Step 3: e2e**(`e2e.test.ts`에 1건) — `examples/legacy-demo` 복사본: `runAudit` → `runInstall({ root, home: tmpHome, tools: ["claude-code"] })` → 생성 파일 목록 + `.mcp.json` 스냅샷, `runDecideExplain(root, "Button", { git: false })` 추천 `src/components/ui/button`
- [ ] **Step 4: 실패 확인 → 구현 → 통과** — `pnpm -r build && pnpm test && pnpm typecheck`
- [ ] **Step 5: README** — 상단 커맨드 블록에 `install`·`mcp`·`decide` 추가, "MVP 상태" 문단을 "구현: detect·audit·install·mcp·decide / 계획: init·ai(3b)·migrate·guard·usage"로 갱신, 새 섹션 `## AI 도구 연결` (설치 한 줄, 도구별 산출 위치 표 = Task 7 표, MCP 도구 6개 한 줄씩, 응답 토큰 상한·`--budget`, `--dry-run`/`--force`/사용자 수정 보존 규칙 3줄, 배포 전 로컬 개발은 `--mcp-command "node <abs>/packages/cli/dist/bin.js"`). `packages/{mcp-server,agent-skill}/README.md`는 extractor-css README 형식 한 줄
- [ ] **Step 6: changeset** — `.changeset/ai-surface.md`: frontmatter `"dsmith": minor` + `"@dsmith-dev/mcp-server": minor` + `"@dsmith-dev/agent-skill": minor` + `"@dsmith-dev/core": minor` + `"@dsmith-dev/detect": minor`(fixed 그룹이라 전체가 0.2.0), 본문 "AI 표면: install·mcp·decide, MCP 도구 6개, 슬래시 명령 8개". `pnpm changeset status`로 0.2.0 확인. `.changeset/`이 없으면 이 Step을 건너뛰고 보고서에 적음
- [ ] **Step 7: Commit** — 두 개: `feat(cli): install 서브커맨드 (도구 감지·렌더·safe-write, --dry-run·--force·--global)` / `docs: README AI 도구 연결 섹션과 0.2.0 changeset`

---

## 3a에서 하지 않는 것

- `init`·`ai`·카탈로그 빌더(3b): `ds-init`·`ds-ai` 명령은 "아직 없음" 본문, `get_component.source`는 항상 `"index"`, `deprecated`·`examples`는 생략, `.dsmith/catalog.json`은 읽지 않음(`TokenSourceKind`·`source` 유니온에 `"catalog"`만 예약), `tokens.json`(W3C)·`.ts` 토큰 파일은 `ignored`로 보고만
- `explain_decision`의 `token-cluster` 종류(3b `init`이 decisions.json에 기록하면 `list_decisions`에는 나오지만 카드는 "3b" 에러), `a11yNotes`
- MCP 쓰기 도구(`record_decision` 등) — 결정 기록은 CLI `decide`만
- `uninstall`, 명령이 줄어들 때 남는 파일 정리, `--global`의 cursor·gemini, Claude Desktop(`claude_desktop_config.json`·`.mcpb`), 플러그인 마켓플레이스
- Windows용 `cmd /c npx` 래핑
- `audit --json`의 요약 모드(대형 레포에서 출력이 큼 — 컨트롤러 확인 항목 5에서 크기만 측정)
- MCP HTTP 전송, 인증, 리소스 템플릿·구독, `get_pattern`(상위 스펙 §5)
- migrate·guard·render-diff·usage·benchmark(Plan 4)

## 완료 기준

- 루트 `pnpm -r build && pnpm test && pnpm typecheck` 통과, 기존 e2e 스냅샷 불변
- 인메모리 클라이언트 테스트: 6개 도구·2개 리소스, 스펙 §1.4 세 시나리오(`with-ds-app` resolve_token → 토큰 파일 변수, `legacy-demo` → `source "proposal"`, explain_decision("Button") on with-ds-app → 옵션 2·추천 1), lint_snippet Tailwind·inline·styled 각각 위반
- 1,000개 컴포넌트 합성 인덱스에서 6개 도구 응답 모두 `estimateTokens ≤ 1500`
- install: 2회 실행 무변경(매니페스트 포함), `--dry-run` 무변경, 사용자 수정 보존, `--force` 덮어씀
- 실제 stdio로 `dsmith mcp` 왕복(빌드된 bin)
- MCP 핸들러 6개 모두 core 함수 호출 + 입출력 조립만(리뷰로 확인)

## 컨트롤러 확인 항목 (최종 리뷰 뒤 오케스트레이터가 직접)

1. `examples/legacy-demo` 복사본에 `node packages/cli/dist/bin.js install --all --dry-run --mcp-command "node $(pwd)/packages/cli/dist/bin.js"` → diff 확인 → 같은 명령에서 `--dry-run` 빼고 실행 → 생성 파일을 눈으로 확인(SKILL.md frontmatter, `.mcp.json`, `.gemini/commands/ds.toml`, `AGENTS.md` 블록 ≤40줄) → 두 번째 실행 "유지 N"
2. 실제 Claude Code로 1회: 위 복사본을 열어 `.mcp.json` 승인 → `/ds-audit` 실행(숫자가 JSON과 일치하는지), `/ds-decide`로 Button 카드 1장 → 선택 → `.dsmith/decisions.json` 기록 확인. 가능하면 Gemini CLI 또는 Cursor 중 하나에서 `/ds-audit` 1회
3. **MCP 서버 작업 디렉터리** — 각 도구가 stdio 서버를 레포 루트에서 띄우는지(부록 A에서 미확인). stderr의 `dsmith mcp: root=…` 로그로 확인. 다르면 렌더러에 `--root`(또는 Gemini `cwd`) 추가를 후속 수정으로 기록
4. `npx @modelcontextprotocol/inspector node packages/cli/dist/bin.js mcp --root <복사본>`(가능하면)로 도구 목록·응답 크기 확인
5. 비공개 실제 레포(컨테이너 스크래치): `mcp`의 `search_component`·`explain_decision` 응답 토큰 수, `audit --json` 출력 크기 → `docs/decisions/`에 익명 기록(숫자만)
6. Cursor 명령 파일 이름 규칙(파일명 = 명령 이름)과 인자 처리 — 부록 A에서 추론으로 남은 항목을 실제 Cursor에서 확인

---

## 부록 A. 외부 규약 확인 기록 (2026-11-01)

구현자는 다시 조사하지 않는다. 렌더러·서버 파일 상단 주석에 해당 행의 날짜·URL을 옮긴다. "미확인"은 폴백을 따른다.

### A.1 MCP TypeScript SDK — 확인(설치·컴파일·실행)

- 현재 안정판은 **v2**: 패키지가 `@modelcontextprotocol/server`·`@modelcontextprotocol/client`로 나뉘었다. 둘 다 `2.4.0`(2026-10-23), v2.0.0 = 2026-07-27. v1 `@modelcontextprotocol/sdk`는 `1.32.2`(2026-10-23)로 유지보수 라인(v2 출시 후 최소 6개월 버그·보안 수정). 출처: https://registry.npmjs.org/@modelcontextprotocol/server , https://github.com/modelcontextprotocol/typescript-sdk (main = v2, "stable release line, implementing the 2026-07-28 MCP spec"), 문서 https://ts.sdk.modelcontextprotocol.io/v2/
- `@modelcontextprotocol/server@2.4.0` 의존성: `zod ^4.2.0`, `@modelcontextprotocol/core 2.4.0`. `engines.node >=20`. 지원 프로토콜 버전(`@modelcontextprotocol/core` 2.4.0 `SUPPORTED_PROTOCOL_VERSIONS`): 2024-11-05 … 2025-11-25(최신 협상), 기본 협상 2025-03-26 — 현재 클라이언트와 호환
- import 경로: `McpServer`, `InMemoryTransport`(테스트용, `createLinkedPair()`) ← `@modelcontextprotocol/server`; `StdioServerTransport` ← `@modelcontextprotocol/server/stdio`; `Client` ← `@modelcontextprotocol/client`; `StdioClientTransport` ← `@modelcontextprotocol/client/stdio`; zod ← `zod/v4`
- `registerTool(name, { title?, description?, inputSchema?: z.object(...), outputSchema?, annotations? }, (args, ctx) => CallToolResult)` — raw shape(`{ a: z.string() }`) 형태는 deprecated, `z.object` 사용. `registerResource(name, "tokens://list", { mimeType }, (uri: URL, ctx) => ({ contents: [{ uri: uri.href, text }] }))`
- 2026-11-01 로컬 스모크 테스트(TS 5.7, `module/moduleResolution NodeNext`, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `skipLibCheck`, `verbatimModuleSyntax`)에서 아래가 컴파일·실행됨. 잘못된 인자는 throw가 아니라 `isError: true` 결과로 돌아옴:
  ```ts
  import { McpServer, InMemoryTransport } from "@modelcontextprotocol/server";
  import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
  import { Client } from "@modelcontextprotocol/client";
  import * as z from "zod/v4";
  const server = new McpServer({ name: "dsmith", version: "0.2.0" });
  server.registerTool("resolve_token",
    { description: "x", inputSchema: z.object({ raw: z.string(), property: z.string().optional() }) },
    async ({ raw, property }) => ({ content: [{ type: "text", text: JSON.stringify({ raw, property: property ?? null }) }] }));
  server.registerResource("tokens", "tokens://list", { mimeType: "application/json" },
    async (uri) => ({ contents: [{ uri: uri.href, text: "{}" }] }));
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await server.connect(st);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(ct);
  await client.callTool({ name: "resolve_token", arguments: { raw: "#fff" } });   // content[0].text
  await client.readResource({ uri: "tokens://list" });
  ```
- 주의: SDK README — "TypeScript ≥6.0 no longer auto-includes `@types/*` — add `"types": ["node"]`". 현재 레포는 TS 5.7이라 조치 불필요(TS 6 올릴 때 mcp-server tsconfig에 추가)
- **폴백(미확인):** v2 타입이 레포 설정에서 깨지는 일이 생기면 `@modelcontextprotocol/sdk@^1.32`로 내린다 — v1 경로(기억 기반, 미확인): `@modelcontextprotocol/sdk/server/mcp.js`(McpServer), `.../server/stdio.js`, `.../inMemory.js`, `.../client/index.js`. `server.ts`만 고치면 되게 SDK import를 그 파일에 가둔 이유

### A.2 Claude Code — 확인

- 스킬: 프로젝트 `.claude/skills/<skill-name>/SKILL.md`, 개인 `~/.claude/skills/<skill-name>/SKILL.md`. frontmatter는 파일 첫 줄 `---`부터. 필드 전부 선택(`description` 권장), `name` = "/ 메뉴에 보이는 명령 이름, 기본값은 디렉터리 이름", `argument-hint`, `allowed-tools`, `disable-model-invocation` 등; 모르는 필드는 무시. 인자: `$ARGUMENTS`(없으면 본문 끝에 `ARGUMENTS: <입력>` 자동 추가). `/skill-name`으로 실행. 출처: https://code.claude.com/docs/en/skills
- `.mcp.json`: 프로젝트 루트, 최상위 `mcpServers` → 서버 이름 → `{ command, args, env }`; `type` 없으면 stdio. 대화형 세션은 프로젝트 서버 사용 전 승인을 묻는다(`claude mcp reset-project-choices`로 초기화). `${VAR}` 확장 지원. 출처: https://code.claude.com/docs/en/mcp
- Agent Skills 공통 규격: `name` 필수 1~64자, 소문자·숫자·하이픈, 하이픈으로 시작·끝 금지, `--` 금지, **부모 디렉터리 이름과 같아야 함**; `description` 필수 1~1024자; `metadata`는 문자열→문자열 맵. 출처: https://agentskills.io/specification

### A.3 Codex — 확인

- 스킬: `.agents/skills`를 현재 디렉터리부터 레포 루트까지 스캔, 사용자 `$HOME/.agents/skills`. `SKILL.md`는 `name`·`description` 필수. 호출: `$skill-name` 또는 `/skills`, description이 맞으면 암묵 호출. 출처: https://learn.chatgpt.com/docs/build-skills (https://developers.openai.com/codex/skills 에서 302)
- MCP: `~/.codex/config.toml`, **프로젝트 `.codex/config.toml`(신뢰한 프로젝트에서만)**, 테이블 `[mcp_servers.<name>]`, stdio 필드 `command`(필수)·`args`·`env`·`env_vars`·`cwd`, 공통 `startup_timeout_sec`(기본 10)·`tool_timeout_sec`(기본 60)·`enabled`. 출처: https://learn.chatgpt.com/docs/extend/mcp?surface=cli (https://developers.openai.com/codex/mcp 에서 302). 문서의 TOML 예시 원문은 인용 한도로 확보 못 함 — 이 계획의 블록은 확인된 필드 이름으로 구성
- 스펙과의 차이: 스펙 §1.1은 Codex MCP를 `--global`에서만 쓰라 했으나 프로젝트 `.codex/config.toml`이 확인돼 repo 모드에서도 마커 블록으로 쓰고 신뢰 안내 note를 낸다(레포 안에 내려쓴다는 스펙 원칙 쪽을 따름)

### A.4 Cursor — 부분 확인

- 명령: `.cursor/commands/` 디렉터리의 **일반 마크다운 파일**(frontmatter 언급 없음). 출처: https://docs.cursor.com/en/agent/chat/commands. **미확인:** 명령 이름 = 파일명(문서 예시 `review-code.md`에서 추론), 인자 처리, 글로벌 `~/.cursor/commands`. 폴백: 파일명 = 명령 이름으로 렌더, 인자는 본문 문장("명령 뒤에 적은 내용")으로 처리, 글로벌은 스펙대로 미지원 note. https://cursor.com/docs/context/commands 는 명령을 스킬로 옮기는 `/migrate-to-skills`를 언급 — Cursor가 명령을 스킬로 옮기는 중일 수 있으니 컨트롤러 확인 항목 6에서 실제 동작을 본다
- MCP: 프로젝트 `.cursor/mcp.json`, 글로벌 `~/.cursor/mcp.json`, 최상위 `mcpServers`, `command`(필수)·`args`·`env`, stdio 표에 `type: "stdio"`가 있으나 예시는 생략 → 우리는 `type: "stdio"`를 넣는다. 출처: https://cursor.com/docs/context/mcp

### A.5 Gemini CLI — 확인

- 명령: 프로젝트 `<root>/.gemini/commands/`, 이름 = commands 기준 상대 경로(하위 디렉터리는 `:` 네임스페이스), TOML, `prompt`(필수 문자열)·`description`(선택). `{{args}}`는 입력으로 치환, 없으면 입력이 두 줄 띄고 뒤에 붙음. `!{…}` 셸 주입(확인 받음), `@{…}` 파일 주입. 출처: https://geminicli.com/docs/cli/custom-commands/
- MCP: 프로젝트 `.gemini/settings.json`, 사용자 `~/.gemini/settings.json`, `mcpServers` → `{ command, args, env, cwd, timeout(ms, 기본 600000), trust, includeTools }`. 도구 이름은 `mcp_{serverName}_{toolName}`, 서버 이름에 밑줄을 쓰지 말 것(정책 파서) → `dsmith` 적합. 출처: https://geminicli.com/docs/tools/mcp-server/

### A.6 보조 라이브러리 — 확인(설치·컴파일·실행, 2026-11-01)

- `diff` 9.0.0(2026-04-13, 타입 내장): `import { createTwoFilesPatch } from "diff"` — `createTwoFilesPatch(rel, rel, before, after, "", "", { context: 3 })`
- `yaml` 2.9.1(2026-09-11, 타입 내장): `import { parse, stringify } from "yaml"` — `stringify({ description: 'a: b "q"' })`가 안전하게 따옴표 처리
- `zod` 4.6.7(2026-10-12) — SDK 요구 `^4.2.0`

### A.7 미확인 항목 요약

| 항목 | 폴백 | 확인 주체 |
| --- | --- | --- |
| 각 AI 도구가 stdio MCP 서버를 띄우는 작업 디렉터리 | `dsmith mcp` root = cwd, stderr에 root 로그 | 컨트롤러 3 |
| Cursor 명령 이름 규칙·인자·글로벌 위치 | 파일명 = 이름, 인자는 문장, 글로벌 미지원 | 컨트롤러 6 |
| MCP SDK v1 import 경로(폴백 시에만) | 문서 확인 후 `server.ts`만 수정 | 폴백이 필요할 때 구현자 |
| Windows에서 `npx` 직접 실행 | 범위 밖 | — |
