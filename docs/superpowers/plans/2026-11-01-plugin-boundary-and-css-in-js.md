# Plan 2: 플러그인 경계 보강 + CSS-in-JS·MUI sx Extractor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extractor가 자기 파일 글롭과 방식을 선언하고 core/detect/cli가 그것만 보고 동작하게 만든 뒤, 그 구조 위에 `css`·`styled`·`emotion`·`mui-sx` Extractor를 추가해 CSS-in-JS 레포도 분석되게 한다.

**Architecture:** `ExtractorMeta { name, files, parses }`가 계약의 일부가 된다. 인덱서는 메타의 글롭 합집합으로 파일을 모으고 JS/TS에서만 컴포넌트를 파싱한다. detect는 cli가 넘긴 `available` 메타로 `activeExtractors`를 정한다. core에 CSS 선언 텍스트 파서와 CSS 속성 매핑을 두고 네 Extractor가 공유한다.

**Tech Stack:** 기존(TS 5.7 NodeNext, pnpm, vitest, @babel/parser, culori, fast-glob) + `picomatch` (글롭 매칭).

**Spec:** `docs/superpowers/specs/2026-11-01-plugin-boundary-and-css-in-js-design.md`

## Global Constraints

- 패키지 스코프 `@dsmith-dev/*`, CLI `dsmith`; ESM only; `tsconfig.base.json` 상속(`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- Core는 `extractor-*`를 import하지 않는다(테스트 전용 devDependency 예외). detect는 core만 import. cli만 모든 Extractor를 안다
- Extractor 이름 = detect 방식 이름 = cli 레지스트리 키: `tailwind`, `inline-style`, `css`, `styled`, `emotion`, `mui-sx`
- `StyleSource`는 변경하지 않는다(`hardcoded | tailwind-default | token | dynamic`). 테마 스케일 참조는 `token`
- 대상 레포에 쓰는 파일은 `.dsmith/` 아래만
- 커밋: 한국어 conventional prefix, Co-Authored-By 없음, author `dahee <dahee@project-hh.com>`(preconfigured)
- 파일 하나가 실패해도 run은 계속(all-or-nothing per file), skip reason에 Extractor 이름

## Review Focus

1. 혼합 레포(tailwind + styled + sx 한 파일) — 세 Extractor가 같은 파일에서 각자 usage를 내고 서로 중복 집계하지 않음(styled 템플릿 안의 `#fff`를 tailwind가 세지 않음) → Task 8 `mui-app`/`styled-app` e2e + Task 5 테스트
2. `.css` 파일이 `parse` skip으로 잡히면 안 됨(컴포넌트 파싱은 JS/TS만) → Task 2 테스트
3. 템플릿 리터럴의 `${}`가 값 중간에 있는 선언(`color: ${p => p.c}`, `padding: ${x}px 8px`)은 dynamic 1건, 그 선언의 다른 리터럴 값은 세지 않음 → Task 4 css-text 테스트, Task 5
4. MUI `p: 2`는 hardcoded가 아니라 token(테마 스케일), `p: "13px"`는 hardcoded, `color: "#111"`는 hardcoded → Task 6
5. `@mui/material` vs `@mui/material/Button` import가 같은 모듈로 묶여 중복이 아님; 같은 파일 안 로컬 정의 컴포넌트는 중복이 아니라 지역 재정의 → Task 7

---

## File Structure

```
packages/extractor-api/src/extractor.ts        ExtractorMeta 추가, Extractor extends ExtractorMeta, prepare?
packages/extractor-api/src/conformance.ts      meta 검사(files 비어있지 않음, name 형식)
packages/core/src/index/indexer.ts             글롭 합집합, picomatch 매칭, JS/TS 전용 컴포넌트 파싱, prepare 호출
packages/core/src/index/specifier.ts           normalizePackageSpecifier, readTsconfigPaths, resolveWithPaths
packages/core/src/index/component-usage.ts     module 필드, paths 별칭 해석
packages/core/src/model/component-usage.ts     ComponentUsage.module
packages/core/src/model/css-property.ts        cssPropertyToStyleProperty (inline-style에서 이동) + isLengthProperty + isColorProperty
packages/core/src/parse/css-text.ts            parseCssDeclarations
packages/detect/src/detect-styling.ts          available 주입, sx/css 방식, IMPLEMENTED_EXTRACTORS 삭제
packages/detect/src/detect-ds.ts               packageName 우선순위
packages/detect/src/index.ts                   detect(root, index?, opts?)
packages/extractor-css/src/{extract,write,index}.ts
packages/extractor-styled/src/{template,extract,write,index}.ts     template.ts = 템플릿 리터럴 → css-text 호출 공용 (emotion이 import)
packages/extractor-emotion/src/{extract,write,index}.ts
packages/extractor-mui-sx/src/{theme-scale,extract,write,index}.ts
packages/cli/src/registry.ts                   6종 + metas()
packages/cli/src/commands/audit.ts             available 전달, localDefinitions
packages/cli/src/report/audit-report.ts        지역 재정의 섹션
fixtures/{styled-app,emotion-app,mui-app}/
```

---

### Task 1: 계약 v2 + conformance + 기존 Extractor 메타

**Files:**
- Modify: `packages/extractor-api/src/extractor.ts`, `packages/extractor-api/src/conformance.ts`, `packages/extractor-api/src/index.ts`
- Modify: `packages/extractor-inline-style/src/extract.ts`(메타 추가), `packages/extractor-tailwind/src/extract.ts`(메타 추가)
- Test: `packages/extractor-api/test/conformance.test.ts`(확장), 각 Extractor 테스트에 메타 단언 1개

**Interfaces:**
- Produces:
  ```ts
  export interface ExtractorMeta { name: string; files: string[]; parses: "tsx" | "none" }
  export interface Extractor extends ExtractorMeta {
    appliesTo(ctx: ExtractContext): boolean;
    extract(ctx: ExtractContext): StyleUsage[];
    write(usage: StyleUsage, tokenRef: string): WritePatch | null;
    prepare?(root: string): Promise<void> | void;
  }
  export const JS_FILES = ["**/*.{tsx,jsx,ts,js}"];           // 공용 상수
  export function metaOf(e: Extractor): ExtractorMeta;        // {name, files, parses}만 추려 반환
  ```
  `runConformance`는 케이스 실행 전에 메타를 검사해 실패 시 `failed`에 `{ case: -1, reason: "meta: …" }`를 넣는다: `files.length === 0`, `name`이 `/^[a-z][a-z0-9-]*$/`가 아님, `parses`가 두 값 외.

- [ ] **Step 1: 실패하는 테스트** — conformance.test.ts: `files: []`인 더미 Extractor → `failed[0].case === -1`, reason에 `meta`; `name: "Bad_Name"` → 동일; 정상 메타 더미는 기존대로 통과. inline-style·tailwind 테스트에 `expect(metaOf(x)).toEqual({ name: "inline-style", files: JS_FILES, parses: "tsx" })`(tailwind는 `name: "tailwind"`)
- [ ] **Step 2: 실패 확인** — `pnpm --filter @dsmith-dev/extractor-api test`, 두 Extractor 테스트 — FAIL(타입/런타임)
- [ ] **Step 3: 구현** — 타입, `metaOf`, conformance 메타 검사; 두 Extractor 객체에 `files: JS_FILES, parses: "tsx"` 추가
- [ ] **Step 4: 통과 확인** — `pnpm -r build && pnpm test && pnpm typecheck`
- [ ] **Step 5: Commit** — `feat(extractor-api): Extractor 메타(files·parses)와 prepare 훅 추가`

---

### Task 2: 인덱서 — 글롭 합집합, JS/TS 전용 파싱, 경계 테스트

**Files:**
- Modify: `packages/core/src/index/indexer.ts`, `packages/core/package.json`(`picomatch`, `@types/picomatch`)
- Test: `packages/core/test/indexer.test.ts`(추가)

**Interfaces:**
- Consumes: `ExtractorMeta`, `JS_FILES` (Task 1)
- Produces: 동작 변경만. `indexRepo(root, extractors, opts?)` 시그니처 유지. 내부:
  - 파일 글롭 = `unique([...extractors.flatMap(e => e.files), ...JS_FILES])`; `opts.include`가 있으면 그것으로 대체(기존 의미 유지)
  - `isJsFile(file) = /\.[cm]?[jt]sx?$/`; 컴포넌트 파싱은 `isJsFile`일 때만
  - 각 Extractor는 `picomatch(e.files)(file) && e.appliesTo(ctx)`일 때만 호출
  - `for (const e of extractors) await e.prepare?.(root)` 를 순회 전에 1회
  - skip reason: 읽기 실패 `read: …`, Extractor 예외 `parse(<name>): …`, 컴포넌트 파싱 예외 `parse(components): …`

- [ ] **Step 1: 실패하는 테스트** — (a) 가짜 Extractor `{ name: "txt", files: ["**/*.txt"], parses: "none", appliesTo: () => true, extract: ctx => [usage(ctx.file)] , write: () => null }` + `notes.txt`, `a.tsx` → `styles`에 `notes.txt` usage 1건, `files.scanned 2`, `skipped []`(txt는 컴포넌트 파싱 안 함); (b) `prepare`가 파일 순회 전에 정확히 1회 호출(호출 순서 배열로 단언); (c) 두 Extractor가 같은 `.tsx`에 둘 다 적용되지만 `files`가 `**/*.css`인 Extractor는 `.tsx`에 호출되지 않음(spy); (d) 던지는 Extractor의 skip reason이 `parse(bad): boom`
- [ ] **Step 2: 실패 확인 → 구현 → 통과** — `pnpm --filter @dsmith-dev/core test`
- [ ] **Step 3: Commit** — `feat(core): 인덱서가 Extractor 글롭 합집합으로 파일을 모으고 JS/TS에서만 컴포넌트를 파싱`

---

### Task 3: detect — `available` 주입, `sx`·`css` 방식, 대표 패키지 우선순위

**Files:**
- Modify: `packages/detect/src/detect-styling.ts`, `packages/detect/src/detect-ds.ts`, `packages/detect/src/index.ts`
- Modify: `packages/cli/src/registry.ts`(`metas()`), `packages/cli/src/commands/{detect,audit}.ts`(`available` 전달)
- Test: `packages/detect/test/detect.test.ts`(추가), `packages/cli/test/cli.test.ts`(available 전달 1건)

**Interfaces:**
- Produces:
  ```ts
  export type StylingMethodName = "tailwind" | "inline-style" | "css" | "css-modules" | "styled" | "emotion" | "sx";
  export interface DetectOptions { available?: ExtractorMeta[] }
  export function detect(root: string, index?: Index, opts?: DetectOptions): Promise<DetectResult>;
  // DetectResult에 추가: extractorsResolved: boolean  (available이 주어졌는지)
  export function activeExtractorsOf(styling: StylingDetection, available: ExtractorMeta[] | undefined): string[];
  // registry.ts
  export function metas(): ExtractorMeta[];
  ```
  규칙(스펙 §5): `available` 없음 → `activeExtractors = methods.map(m => m.name)`, `extractorsResolved false`, 폴백 없음. 있음 → 교집합; 비면 `available`에 `inline-style`이 있을 때만 `["inline-style"]` + evidence `"fallback"`. `sx` 근거: `@mui/material`|`@mui/joy` 의존 AND 소스에 `sx={{` 1회 이상. `css` 근거: `.module.` 아닌 `*.css|scss` 파일 1개 이상(제외 디렉터리 밖). detect-ds: `packageName = packageNames.find(n => !/icons|\/x-|styled-engine|utils|system/.test(n)) ?? packageNames[0]`.

- [ ] **Step 1: 실패하는 테스트** — detect: (a) `available` 없이 호출 → `activeExtractors` = 방식 이름 그대로, `extractorsResolved false`; (b) `available = [{name:"tailwind",…}]`이고 방식이 styled만 → `activeExtractors []`(inline-style이 available에 없으므로 폴백 없음); (c) `@mui/material` 의존 + `sx={{` 파일 → methods에 `sx`; (d) `styles/app.css` 있음 → methods에 `css`, `a.module.css`만 있음 → `css` 없음; (e) `@mui/icons-material`,`@mui/material` 순 의존 → `packageName "@mui/material"`. cli: `runAudit` 후 `detect.json`의 `extractorsResolved true`
- [ ] **Step 2: 실패 확인 → 구현(IMPLEMENTED_EXTRACTORS 삭제) → 통과** — `pnpm -r build && pnpm test`
- [ ] **Step 3: Commit** — `feat(detect): 사용 가능한 Extractor를 호출자에게서 받고 sx·css 방식과 대표 패키지 우선순위 추가`

---

### Task 4: core `css-text` 파서 + `css-property` 이동 + `extractor-css`

**Files:**
- Create: `packages/core/src/parse/css-text.ts`, `packages/core/src/model/css-property.ts`
- Modify: `packages/core/src/index.ts`, `packages/extractor-inline-style/src/extract.ts`(core의 매핑을 import, 로컬 복사 삭제)
- Create: `packages/extractor-css/{package.json,tsconfig.json}`, `src/{extract,write,index}.ts`
- Test: `packages/core/test/{css-text,css-property}.test.ts`, `packages/extractor-css/test/{extract,write}.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // css-text.ts
  export interface CssDecl { property: string; value: string; start: number; end: number; dynamic: boolean }
  export const PLACEHOLDER = /\u0000(\d+)\u0000/;              // 템플릿 ${} 자리 표식
  export function parseCssDeclarations(text: string, offset?: number): CssDecl[];
  // css-property.ts
  export function cssPropertyToStyleProperty(prop: string): StyleProperty;   // camelCase·kebab 모두 수용
  export function isLengthProperty(p: StyleProperty): boolean;              // padding|margin|gap|width|height|font-size|border-radius
  export function isColorProperty(p: StyleProperty): boolean;               // color|background-color|border-color|fill|stroke
  export function splitShorthandColor(prop: string, value: string): { property: StyleProperty; colorText: string; start: number; end: number } | null;
  // background/border/outline 값에서 색 토큰(hex|rgb()|hsl()|named via normalizeColor) 하나를 찾아 위치와 함께 반환; 없으면 null
  export const cssExtractor: Extractor;   // name "css", files ["**/*.{css,scss}"], parses "none"
  ```
  `parseCssDeclarations` 규칙: `/* */` 주석 제거(위치 보존을 위해 공백으로 치환), `{}` 블록 재귀, 선언 = `ident\s*:\s*value\s*;`(마지막 선언은 `;` 생략 허용, `}` 앞), 값에 PLACEHOLDER가 있으면 `dynamic: true`. `start/end`는 값 구간(앞뒤 공백 제외). `extractor-css`: 각 선언 → `cssPropertyToStyleProperty`; 색 속성은 `normalizeColor`, 길이 속성은 `normalizeLength`, 축약은 `splitShorthandColor`; `var(--x)`·`$var` 값 → `token`; `appliesTo` = 파일명에 `.module.` 없음. `write` = 값 구간 치환.

- [ ] **Step 1: 실패하는 테스트** — css-text: `a{color:#fff;padding:12px}` → 2 decl with exact start/end; `&:hover { color: red }` 중첩; 주석 안의 `color:#000` 무시; 마지막 `;` 없음; `padding: \u00000\u0000px 8px;` → dynamic. css-property: `backgroundColor`/`background-color` 둘 다 `background-color`; `splitShorthandColor("border","1px solid #000")` → `{property:"border-color", colorText:"#000", start:10, end:14}`; `("background","url(x.png)")` → null. extractor-css conformance: `.btn{color:#3B82F6;padding:13px;background:var(--bg)}` → hardcoded color, hardcoded length 13, token; `.module.css` → `appliesTo false`. write: 값만 치환
- [ ] **Step 2: 실패 확인 → 구현 → 통과** (inline-style 테스트가 그대로 통과하는지 확인 — 이동만, 동작 변화 없음)
- [ ] **Step 3: Commit** — 두 개: `feat(core): CSS 선언 텍스트 파서와 공용 CSS 속성 매핑 추가` / `feat(extractor-css): .css/.scss 파일 Extractor 추가`

---

### Task 5: `extractor-styled` + `extractor-emotion`

**Files:**
- Create: `packages/extractor-styled/{package.json,tsconfig.json}`, `src/{template,extract,write,index}.ts`
- Create: `packages/extractor-emotion/{package.json,tsconfig.json}`, `src/{extract,write,index}.ts` (depends on `@dsmith-dev/extractor-styled` for `template.ts`)
- Test: 각 `test/{extract,write}.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // extractor-styled/src/template.ts
  export interface TemplateDecl extends CssDecl { codeStart: number; codeEnd: number }   // 값의 소스 코드 오프셋
  export function declarationsFromTemplate(tpl: TemplateLiteral, code: string): TemplateDecl[];
  // quasis를 이어 붙이되 각 ${} 자리에 PLACEHOLDER(index)를 넣고 parseCssDeclarations 호출; 값 오프셋을 원본 코드 오프셋으로 역변환. PLACEHOLDER가 값에 걸친 선언은 dynamic(코드 오프셋은 선언 전체)
  export function usagesFromDecls(decls: TemplateDecl[], ctx: ExtractContext, extractorName: string): StyleUsage[];
  export const styledExtractor: Extractor;   // name "styled", files JS_FILES, parses "tsx"
  export const emotionExtractor: Extractor;  // name "emotion"
  ```
  styled 추출 대상(TaggedTemplateExpression): tag가 `styled.x`, `styled(X)`, `styled.x.attrs(...)`, `styled(X).attrs(...)`, `css`(styled-components에서 import), `createGlobalStyle`, `keyframes`는 무시. 객체 문법 `styled.div({...})`/`styled.div(props => ({...}))`: ObjectExpression의 리터럴 값은 inline-style과 같은 규칙(값 노드 치환). 귀속: `styled` 식별자의 import 출처가 `@emotion/styled`면 emotion Extractor가, `styled-components`면 styled가 담당 — 두 Extractor가 같은 파일을 볼 때 **중복 집계 금지**: 각 Extractor는 자기 패키지에서 import된 식별자만 처리하고, import가 없는 `styled` 사용은 styled Extractor만 처리. emotion 추가 대상: JSX `css={{...}}`(객체) 와 `css={css\`…\`}`, `@emotion/react`의 `css\`…\`` 태그.

- [ ] **Step 1: 실패하는 테스트** — styled conformance: `` const B = styled.button`color:#3B82F6;padding:13px 8px;` `` → color hardcoded, padding: `13px 8px` 복합값 → 첫 길이 13 hardcoded(값 전체가 raw), `` `color: ${p => p.c};` `` → dynamic 1, `` `margin: ${m}px 8px` `` → dynamic 1(8px 안 셈); `styled(Base)`, `.attrs({})`; 객체 문법 `styled.div({ color: "#fff" })`; `@emotion/styled`에서 import한 파일에서는 styledExtractor가 0건. emotion: `css={{ color: "#fff" }}`, `` css`color:#fff` `` from `@emotion/react`, `@emotion/styled`의 `styled.div\`…\``; `styled-components`에서 import한 파일에서는 0건. write: 템플릿 값 구간 치환으로 원본 재조립 확인
- [ ] **Step 2: 실패 확인 → 구현 → 통과** — 패키지 두 개 모두 `pnpm -r build && pnpm test`
- [ ] **Step 3: Commit** — `feat(extractor-styled): styled-components 템플릿·객체 문법 Extractor 추가` / `feat(extractor-emotion): css prop·@emotion/styled Extractor 추가`

---

### Task 6: `extractor-mui-sx`

**Files:**
- Create: `packages/extractor-mui-sx/{package.json,tsconfig.json}`, `src/{theme-scale,extract,write,index}.ts`
- Test: `test/{theme-scale,extract,write}.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const SPACING_PROPS = ["p","px","py","pt","pr","pb","pl","m","mx","my","mt","mr","mb","ml","gap","rowGap","columnGap","padding","margin"];
  export function spacingToPx(n: number, unit = 8): number;
  export function isPalettePath(v: string): boolean;        // /^(primary|secondary|error|warning|info|success|text|background|grey|common|divider|action)(\.[a-zA-Z0-9]+)*$/
  export const muiSxExtractor: Extractor;   // name "mui-sx", files JS_FILES, parses "tsx"
  ```
  규칙: JSXAttribute `sx` 값이 ObjectExpression / ArrayExpression(요소 각각) / ConditionalExpression(양쪽) / LogicalExpression(우측). 각 ObjectProperty: SPACING_PROPS + NumericLiteral → `{kind:"length", px: n×8}`, `source:"token"`, raw = 숫자 텍스트; 문자열 길이/색 리터럴 → inline-style 규칙(hardcoded); `color|bgcolor|backgroundColor|borderColor` + 팔레트 경로 문자열 → token unknown; 중첩 객체(`"&:hover": {...}`, `[theme.breakpoints...]`) 재귀; 함수값 `(theme) => …` → dynamic 1. 속성 매핑: `bgcolor`→`background-color`, `p`→`padding`, `m`→`margin`, `fontSize`→`font-size`, `borderRadius`→`border-radius`. `borderRadius: <number>`는 MUI 기본 `theme.shape.borderRadius`(4px)의 배수 → `{kind:"length", px: n×4}`, `source:"token"`.

- [ ] **Step 1: 실패하는 테스트** — `sx={{ p: 2, color: "#111", bgcolor: "primary.main", fontSize: "13px", borderRadius: 1 }}` → padding token 16px, color hardcoded #111111, background-color token unknown, font-size hardcoded 13, border-radius token 4; `sx={[{ p: 1 }, cond && { m: 2 }]}` → 둘 다; `sx={(t) => ({...})}` → dynamic 1; `sx={{ "&:hover": { color: "#fff" } }}` → 재귀; write: `color: "#111"` 치환
- [ ] **Step 2: 실패 확인 → 구현 → 통과**
- [ ] **Step 3: Commit** — `feat(extractor-mui-sx): MUI sx prop Extractor 추가 (테마 스케일은 token)`

---

### Task 7: 서브패스·tsconfig paths·지역 재정의 + 리포트

**Files:**
- Modify: `packages/core/src/index/specifier.ts`, `component-usage.ts`, `model/component-usage.ts`
- Modify: `packages/detect/src/detect-ds.ts`(`isDsSpecifier`가 `module` 사용), `detect-state.ts`
- Modify: `packages/cli/src/commands/audit.ts`, `audit-result.ts`, `report/audit-report.ts`
- Test: `packages/core/test/{specifier,component-usage}.test.ts`, `packages/cli/test/{cli,audit-report}.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function normalizePackageSpecifier(spec: string): string;     // "@mui/material/Button"→"@mui/material", "lodash/fp"→"lodash", 상대/루트 경로는 그대로
  export interface TsPaths { baseUrl: string; paths: Record<string, string[]> }
  export function readTsconfigPaths(root: string): Promise<TsPaths | null>;   // tsconfig.json→jsconfig.json 순, extends 1단계
  export function resolveWithPaths(spec: string, importer: string, tsPaths: TsPaths | null): string | null; // 매칭 시 루트 상대 POSIX, 확장자 제거
  // ComponentUsage에 추가: module: string   (패키지는 normalizePackageSpecifier, 경로는 resolve 결과; null import는 "" )
  // AuditResult에 추가: localDefinitions: { name: string; files: number }[]  (importedFrom null인 이름별 정의 파일 수, 2 이상만, 내림차순 상위 20)
  // duplicates: 그룹 키 name+module, importedFrom null 제외
  ```
  `indexRepo`는 시작 시 `readTsconfigPaths(root)`를 한 번 읽어 `extractComponentUsage(file, ast, tsPaths)`에 넘긴다(세 번째 인자 추가, 기존 호출은 `null`). `@/`·`~/` 규칙은 `paths`가 없을 때의 폴백으로 유지.

- [ ] **Step 1: 실패하는 테스트** — specifier: 네 가지 정규화; `paths: {"@/*":["./src/*"], "components/*":["./src/components/*"]}` 임시 tsconfig → `resolveWithPaths("components/ui/button","app/page.tsx",…)` = `src/components/ui/button`; component-usage: `module` 채워짐, `@mui/material/Button`과 `@mui/material`에서 온 `Button` 두 건의 `module` 동일; cli: 그 둘은 duplicates에 없음, 같은 파일에 `function Header(){}` 정의 + `<Header/>`가 두 파일 → `localDefinitions [{name:"Header", files:2}]`이고 duplicates에 없음; 리포트에 `## 지역 재정의 컴포넌트` 표
- [ ] **Step 2: 실패 확인 → 구현 → 통과** — e2e 스냅샷은 변하면 안 됨(legacy-demo/with-ds-app 중복은 그대로 Button/Badge); 변하면 원인을 보고서에 적음
- [ ] **Step 3: Commit** — `feat(core): 패키지 서브패스 정규화와 tsconfig paths 별칭 해석` / `feat(cli): 지역 재정의 컴포넌트 집계와 리포트 섹션`

---

### Task 8: fixtures 3종 + e2e + 레지스트리 + README

**Files:**
- Create: `fixtures/styled-app/`, `fixtures/emotion-app/`, `fixtures/mui-app/` (각 package.json + 3~5 파일)
- Modify: `packages/cli/src/registry.ts`(6종), `packages/cli/test/e2e.test.ts`, `README.md`
- Test: e2e 3건 추가

**Interfaces:** 레지스트리 키 = 6개 이름. `metas()`는 6개.

- [ ] **Step 1: fixture 작성** — `styled-app`: styled-components 의존, 브랜드색 `#3B82F6`/`#3C83F7` 템플릿 리터럴, `${p => …}` 1건, 로컬 `Header` 2파일 정의; `emotion-app`: `@emotion/react` + `@emotion/styled`, css prop 객체·태그, 하드코딩 색 2종; `mui-app`: `@mui/material` + `@mui/icons-material`, `sx` 숫자 스케일·팔레트 경로·`"13px"`·`#111`, `Button`을 `@mui/material`과 `@mui/material/Button` 양쪽에서 import(중복 아님)
- [ ] **Step 2: 실패하는 e2e** — styled-app: `activeExtractors ["styled"]`(inline이 없으면), 색 클러스터 1개(두 변종 병합), `dynamicCount 1`, `localDefinitions` Header 2; emotion-app: `activeExtractors` ⊇ `["emotion"]`, hardcoded 색 2; mui-app: `activeExtractors` ⊇ `["mui-sx"]`, `ds.kind "npm"`, `packageName "@mui/material"`, duplicates `[]`, token 사용 ≥ 2, hardcoded 색 `#111111`; 각 리포트 스냅샷
- [ ] **Step 3: 실패 확인 → 보정 → 통과** — `pnpm -r build && pnpm test && pnpm typecheck`
- [ ] **Step 4: README** — 지원 스타일링 방식 표(6종 + css-modules 감지만), `fixtures/` 7종 목록, 새 Extractor 추가 방법 5줄(메타 선언 → conformance → 레지스트리 1줄)
- [ ] **Step 5: Commit** — `test: styled·emotion·mui fixtures와 e2e, Extractor 6종 레지스트리, README`

---

### Task 9: 실제 레포 재측정 기록

**Files:**
- Create: `docs/decisions/2026-11-01-real-repo-coverage.md`

- [ ] **Step 1:** 컨트롤러가 비공개 레포(컨테이너 스크래치)에 `audit`을 다시 돌려 before(MVP)/after 숫자를 뽑는다: 분석 파일 수, 스타일 사용 수, Extractor별 사용 수, 분석되지 않은 방식, hardcodedShare, dsImportShare, duplicateCount, localDefinitions 상위, 실행 시간
- [ ] **Step 2:** 레포·회사 이름 없이 숫자와 관찰만 기록 (`docs/decisions/`), 도구 한계 목록(다음 계획 입력)
- [ ] **Step 3: Commit** — `docs: 실제 레포 재측정 기록 (Plan 2 before/after)`

---

## 완료 기준

- `pnpm test`/`typecheck` 루트 통과; e2e 7종
- 가짜 `.txt` Extractor 경계 테스트가 core/cli 수정 없이 통과(Task 2)
- 실제 레포에서 "감지됐지만 분석하지 않은 방식"이 `css-modules`만 남음
