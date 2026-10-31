# ds-cli (임시 이름)

운영 중인 코드베이스를 대상으로 디자인시스템(DS)을 진단 → 생성 → 정리 → 운영 → AI 연동까지 끌고 가는 CLI.

```
detect    # 레포를 읽어 스타일링 방식·DS 유무·시작 상태 판별 → .ds-cli/detect.json
audit     # 하드코딩 값 분포, 중복 컴포넌트, 토큰 후보 → .ds-cli/reports/audit-<날짜>.md
```

> **MVP 상태:** 구현된 커맨드는 `detect`와 `audit`뿐이다. `init`(DS 초안 생성), `migrate`(토큰 치환 codemod), `guard`(ESLint 규칙·CI 드리프트 검사), `ai`(MCP 서버·AGENTS.md·슬래시 명령), `usage`(사용량 대시보드)는 계획 단계다 — [설계 스펙](docs/superpowers/specs/2026-10-31-ds-cli-design.md) 참고.

아직 npm에 배포하지 않았으므로 빌드한 뒤 직접 실행한다.

```
pnpm install && pnpm -r build
node packages/cli/dist/bin.js detect --root <repo>
node packages/cli/dist/bin.js audit --root <repo>
```

### 감지 결과 고치기 (`overrides`)

감지가 틀렸으면 `<repo>/.ds-cli/detect.json`에 `overrides`를 추가한다. 다시 감지해도 보존되고 새 결과 위에 적용된다(`state`, `activeExtractors`, `ds`).

```json
{
  "overrides": { "state": 2 }
}
```

## 구조

- `packages/core` — 정규화 모델, 매처, 클러스터링, lint 규칙 (스타일링 방식과 독립)
- `packages/extractor-*` — 스타일링 방식별 플러그인 (`extractor-api`가 계약)
- `packages/ds-source-*` — DS를 읽는 어댑터 (npm 패키지 / 로컬 / bootstrap)
- `packages/detect` — 감지 단계
- `packages/cli`, `eslint-plugin`, `mcp-server`, `agent-skill`, `dashboard` — 표면
- `fixtures/` — 테스트용 최소 레포

## 개발

```
pnpm install
pnpm -r build   # 테스트가 빌드된 dist를 import하므로 test 전에 필요
pnpm test
pnpm typecheck

# fixture로 audit 실행 (결과는 fixtures/<name>/.ds-cli/ 에 생성, git 무시됨)
node packages/cli/dist/bin.js audit --root fixtures/tailwind-app
```
