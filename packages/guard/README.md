# @dsmith-dev/guard

dsmith guard: design-system drift checks for pull requests and ESLint setup.

- `dsmith guard init` writes `.dsmith/guard.json` (token and DS snapshot), wires `@dsmith-dev/eslint-plugin` into a flat `eslint.config.*`, and with `--ci github` writes `.github/workflows/dsmith-guard.yml`.
- `dsmith guard --ci --base <ref>` compares the PR against its merge-base and reports only new hardcoded styles, non-DS components and deprecated components; `--comment` upserts one PR comment.

Notes:

- Commit `.dsmith/guard.json`. CI and ESLint read the same snapshot.
- `guard init` reports why it did not edit the ESLint config, with a snippet to paste: `legacy` (eslintrc is not supported), `unsupported-shape`, `needs-ts-parser` (TS files but no TS parser in the config), `not-eslint` (biome, oxlint), `no-config`. `guard --ci` works in all of these.
- ESLint rules check JS/TS only. CSS and SCSS are checked by `guard --ci`.
- The policy (allow lists, `failOn`) is read from the merge-base's `guard.json`, so a PR cannot loosen its own check. Renamed files are compared with their old path, and `--root` can be a subdirectory.
- Exit code 1 means new drift above the policy, or a tool error (a bad `--base`, a missing or broken `guard.json`); errors print to stderr, the drift report to stdout. A failed PR comment (no token, or a 403 on a fork PR) only prints a warning.
- `staleSnapshot` lists token files changed since `guard init`; a token file not recorded in the snapshot shows as `+<file>`.

Docs: https://github.com/project-hh-org/dsmith#readme
