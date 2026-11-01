export const WORKFLOW_FILE = ".github/workflows/dsmith-guard.yml";

/** 부록 C.4: actions/checkout fetch-depth 0, GITHUB_TOKEN 최소 권한. dsmith 버전을 고정해 CI 결과가 흔들리지 않게 한다. */
export function renderWorkflow(version: string): string {
  return `# dsmith guard init이 생성한 파일입니다. 직접 고치면 다음 guard init이 덮어쓰지 않습니다(--force로 덮어씀).
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
      - run: npx --yes dsmith@${version} guard --ci --base "origin/\${{ github.base_ref }}" --comment
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;
}
