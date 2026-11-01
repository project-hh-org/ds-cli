# Plan 2.5: 배포 파이프라인 (changesets + GitHub Actions)

- 날짜: 2026-11-01
- 상태: 승인 (Plan 2 머지 직후, Plan 3 전에 실행)
- 근거: 설계 스펙 §8 "버전 관리 changesets, GitHub Actions에서 `npm publish --provenance`, 0.x로 시작, MIT, 처음부터 public". Plan 3의 슬래시 명령 설치가 `npx dsmith …`를 전제로 하므로 먼저 필요하다.

## 결정

| 항목 | 결정 | 이유 |
| --- | --- | --- |
| 버전 전략 | changesets **fixed 그룹** 하나: `dsmith` + `@dsmith-dev/*` 전부 같은 버전 | 0.x 단계에서 패키지별 버전 분기는 설명 비용만 늘림. CLI가 전 패키지를 의존하므로 한 버전이 자연스럽다 |
| 시작 버전 | 0.1.0 (첫 changeset `minor`) | 스펙 §8 |
| 공개 범위 | 10개 패키지 전부 public (`publishConfig.access: public`) | 제3자 Extractor 제작에 `@dsmith-dev/extractor-api`가 필요 |
| 비공개 | 루트, `fixtures/*`, `examples/*` 는 `private: true` 유지 → 배포 제외 | 이미 그렇게 돼 있음 |
| 인증 | `NPM_TOKEN` (npm Granular Access Token, dsmith-dev org 쓰기 + `dsmith` 패키지 쓰기, 2FA bypass) → GitHub repo secret | OIDC trusted publishing은 패키지가 npm에 먼저 존재해야 설정 가능. 첫 배포 뒤 전환 검토 |
| provenance | `NPM_CONFIG_PROVENANCE=true` + `id-token: write` | 스펙 §8 |
| CI | `ci.yml`: PR·push(main) 에서 `pnpm install --frozen-lockfile && pnpm build && pnpm test && pnpm typecheck`, Node 20·22 매트릭스 | 머지 전 녹색 보장 |
| 릴리스 | `release.yml`: push(main) → `changesets/action@v1` 이 "Version Packages" PR 생성 → 그 PR 머지 시 `pnpm release`(= `pnpm build && pnpm publish -r && changeset tag`) | 표준 changesets 흐름 |
| 라이선스 | MIT, `LICENSE` 루트 1개, 각 package.json `license: "MIT"`, `author`, `repository`, `homepage` | npm 페이지 메타 |
| 워크스페이스 의존성 | `workspace:*` 그대로 — `pnpm publish -r`이 실제 버전으로 치환 (`changeset publish`는 npm을 호출해 치환 안 됨, pnpm 공식 안내 https://pnpm.io/using-changesets) + `changeset tag`로 태그 | `npm publish` 직접 호출 금지 (치환 안 됨) |

## Tasks

### Task 1: 패키지 메타·LICENSE
- Create: `LICENSE` (MIT, Copyright (c) 2026 Dahee Hwang)
- Modify: 10개 `packages/*/package.json` — `license`, `author: "Dahee Hwang <dahee@project-hh.com>"`, `repository: {type: git, url: https://github.com/project-hh-org/dsmith.git, directory: packages/<name>}`, `homepage`, `publishConfig: {access: public}`, `keywords`(design-system, cli …), 영어 한 줄 `description`(한국어 설명은 README에). `sideEffects: false`.
- 검증: `pnpm -r exec npm pack --dry-run` 결과에 `dist/**`·`package.json`·`README.md`(있으면)만 포함, `src/`·`test/` 미포함. 각 패키지 README 없으면 루트 README 링크 한 줄짜리 README.md 생성 (npm 페이지 공백 방지).
- Commit: `chore: 패키지 메타·LICENSE (npm 배포 준비)`

### Task 2: changesets
- `pnpm add -Dw @changesets/cli @changesets/changelog-github`, `pnpm changeset init`
- `.changeset/config.json`: `"access": "public"`, `"baseBranch": "main"`, `"fixed": [["dsmith", "@dsmith-dev/*"]]`, `"changelog": ["@changesets/changelog-github", {"repo": "project-hh-org/dsmith"}]`, `"ignore": []` (private 패키지는 자동 제외)
- 루트 scripts: `"changeset": "changeset"`, `"version": "changeset version && pnpm install --lockfile-only"`, `"release": "pnpm build && changeset publish"`
- 첫 changeset 파일 `.changeset/initial-release.md`: fixed 그룹 전체 `minor`, 본문 "첫 공개 배포: detect·audit, Extractor 6종"
- 검증: `pnpm changeset status --verbose` 가 10개 패키지 0.0.0 → 0.1.0 을 보여줌 (실제 `changeset version`은 실행하지 않음 — 릴리스 PR이 함)
- Commit: `chore: changesets 도입 (fixed 그룹, 첫 0.1.0 changeset)`

### Task 3: GitHub Actions
- `.github/workflows/ci.yml`: `pnpm/action-setup@v4`(packageManager 필드 사용), `actions/setup-node@v4` cache pnpm, matrix node 20/22, steps install(frozen)/build/test/typecheck. 동시성 그룹으로 중복 실행 취소.
- `.github/workflows/release.yml`: `on: push: branches: [main]`, `permissions: {contents: write, pull-requests: write, id-token: write}`, Node 22, `changesets/action@v1` with `version: pnpm version`, `publish: pnpm release`, `commit: "chore: 버전 올림"`, `title: "chore: 버전 올림 (Version Packages)"`, env `NPM_TOKEN: ${{ secrets.NPM_TOKEN }}`, `NPM_CONFIG_PROVENANCE: true`, `GITHUB_TOKEN`.
- `.github/dependabot.yml` 은 만들지 않는다 (노이즈).
- 검증: `act` 없음 → YAML 파싱(`node -e` yaml 로드 또는 `pnpm dlx yaml-lint` 대신 `python3 -c 'import yaml'` 가능하면) + 푸시 후 `gh api repos/project-hh-org/dsmith/actions/runs`로 ci 녹색 확인(컨트롤러가 함).
- Commit: `ci: CI·릴리스 워크플로 (changesets action, provenance)`

### Task 4: README 설치 섹션 + 배포 절차 문서
- README "실행" 섹션: 배포 후 `npx dsmith audit` / `pnpm dlx dsmith audit`; 아직 미배포 상태 문구는 "0.1.0 배포 전까지는 빌드 후 실행" 로 바꾸고 릴리스 PR 머지 시 자동 배포된다는 한 줄.
- `docs/release.md`: 릴리스 절차 5줄 (changeset 작성 → PR → main 머지 → Version Packages PR 머지 → npm 반영 확인), 필요한 secret, 토큰 권한, 실패 시 재시도 방법, 첫 배포 뒤 trusted publishing 전환 메모.
- Commit: `docs: 설치·릴리스 절차`

## 완료 기준
- `pnpm -r exec npm pack --dry-run` 10개 모두 dist만 포함
- `pnpm changeset status` 가 0.1.0 예정 표시
- 푸시 후 CI 워크플로 녹색 (release 워크플로는 `NPM_TOKEN` 없으면 Version PR 생성까지만 — 그것도 정상 동작으로 간주)
- 사용자 측 필요 작업이 정확히 하나로 정리됨: `NPM_TOKEN` 시크릿 등록

## 사용자 측 작업 (계정 필요)
1. npmjs.com → Access Tokens → Generate New Token → **Granular Access Token**: Packages and scopes: `Read and write`, 범위 `dsmith-dev` org 전체 + (첫 배포 후 생기는) `dsmith` 패키지 — 처음엔 "All packages" 가 간단; Bypass 2FA 체크; 만료 90일 이상
2. GitHub `project-hh-org/dsmith` → Settings → Secrets and variables → Actions → `NPM_TOKEN`
3. 이후 release 워크플로가 만든 "chore: 버전 올림" PR을 머지하면 npm에 0.1.0 게시
