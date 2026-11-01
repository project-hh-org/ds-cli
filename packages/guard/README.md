# @dsmith-dev/guard

dsmith guard: design-system drift checks for pull requests and ESLint setup.

- `dsmith guard init` writes `.dsmith/guard.json` (token and DS snapshot), wires `@dsmith-dev/eslint-plugin` into a flat `eslint.config.*`, and with `--ci github` writes `.github/workflows/dsmith-guard.yml`.
- `dsmith guard --ci --base <ref>` compares the PR against its merge-base and reports only new hardcoded styles, non-DS components and deprecated components; `--comment` upserts one PR comment.

Docs: https://github.com/project-hh-org/dsmith#readme
