# @dsmith-dev/eslint-plugin

ESLint rules for dsmith: no hardcoded style values, prefer design-system components, no deprecated components.

```js
// eslint.config.js
import dsmith from "@dsmith-dev/eslint-plugin";

export default [dsmith.configs.recommended];
```

## Scope and behavior

- **JS/TS only.** The rules run on `js, jsx, mjs, cjs, ts, tsx, mts, cts` files. CSS files are not linted by ESLint; they are checked by `dsmith guard --ci`.
- **Needs `.dsmith/guard.json`.** The rules read the snapshot written by `dsmith guard init` (found by walking up from the linted file, or `settings.dsmith.guardFile`). If it is missing, the rules report nothing. If it is broken, the rules report nothing and Node prints one warning per process. In editors that warning goes to the ESLint server log, so check `dsmith guard` if lint seems silent.
- **Stale snapshot.** If a token file changed after `guard init`, the first message in each file says so, and `no-hardcoded-style` offers its replacement as a suggestion instead of an auto-fix. Run `dsmith guard init` again.
- **Aliased imports.** `import { DialogContent as DC }` and `import * as UI` (`<UI.DialogContent />`) are matched by the imported name.

## `--cache`

ESLint's cache key covers file content and config, not `.dsmith/guard.json`. `configs.recommended` is a getter that adds `settings.dsmith.snapshotHash` (sha256 of `guard.json`, or `"none"`), so the cache is invalidated when the snapshot changes. The file is looked up from `process.cwd()` when the config is evaluated, once per ESLint run. If you point `settings.dsmith.guardFile` at a different file, or do not use `configs.recommended`, rerun without `--cache` after `guard init`. Token file edits are not part of the hash.

Docs: https://github.com/project-hh-org/dsmith#readme
