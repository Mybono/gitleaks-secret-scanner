# Gitleaks Secret Scanner

[![version](https://img.shields.io/badge/version-3.0.0-blue)](https://www.npmjs.com/package/gitleaks-secret-scanner-new)
[![PR Gate](https://github.com/Mybono/gitleaks-secret-scanner/actions/workflows/pr-gate.yml/badge.svg)](https://github.com/Mybono/gitleaks-secret-scanner/actions/workflows/pr-gate.yml)
[![Node.js >=20](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Checked with PR CheckMate](https://img.shields.io/badge/checked_with-PR_CheckMate-2ea44f)](https://www.npmjs.com/package/pr-checkmate)

A zero-configuration Node.js wrapper around [Gitleaks](https://github.com/gitleaks/gitleaks). It downloads and caches the right binary for your OS/arch, then scans staged changes, all uncommitted work, CI pull requests, or full repo history — with rich HTML reports and Husky integration built in.

Every pull request here is gated by [PR CheckMate](https://www.npmjs.com/package/pr-checkmate) — linting, type checks, dependency/vulnerability scanning, and secret scanning bundled into one check, no per-language toolchain setup required.

## Why use it

- **No manual setup** — the correct Gitleaks binary is downloaded and cached automatically per OS/arch.
- **Smart CI mode** (`--diff-mode ci`) — scans the *final content* of changed files instead of every intermediate commit, so a secret added and removed in the same PR doesn't fail the build, while a pre-existing secret in a touched file still gets caught.
- **Safe local scans** — staged-file scanning uses a "virtual commit" (via low-level Git plumbing) to get a full report without touching your branch or index.
- **Rich reports** — console output and HTML reports include file, line, rule, and (in CI mode) author/commit data via `git blame`.

## Install

```bash
npm install gitleaks-secret-scanner-new --save-dev
```

Or run without installing:

```bash
npx gitleaks-secret-scanner-new --diff-mode all --html-report
```

Add scripts to `package.json` as needed:

```json
"scripts": {
  "scan:staged": "gitleaks-secret-scanner",
  "scan:all": "gitleaks-secret-scanner --diff-mode all",
  "scan:history": "gitleaks-secret-scanner --diff-mode history"
}
```

## CLI options

Run `gitleaks-secret-scanner --options` for the full menu, or `--help` for native Gitleaks help.

| Flag | Description |
| :--- | :--- |
| `--diff-mode <mode>` | Scan scope: `staged` (default), `all`, `ci`, `history`. |
| `--html-report [path]` | Write an HTML report (default `gitleaks-report.html`). |
| `--depth <number>` | With `--diff-mode history`, limit the scan to the last N commits. |
| `--gitleaks-version <ver>` | Use a specific Gitleaks version. |
| `--select-version` | Interactively pick a Gitleaks version to install. |
| `--manage-versions` / `--clean-all` | View, clean up, or delete cached Gitleaks binaries. |
| `--engine-version` | Show the installed engine version, binary path, and cache info. |
| `--setup-husky [--command <cmd>]` | Wire up a Husky pre-commit hook. |

Any other flag (`-v`, `-c`, `--redact`, `-f`, `-r`, ...) passes straight through to Gitleaks.

## Version management

The latest stable Gitleaks release is used by default and cached under `~/.gitleaks-cache/` (multiple versions can be cached at once). Use `--gitleaks-version <ver>` or `--select-version` to pin a specific one, and `--manage-versions` / `--clean-all` to free up disk space.

## Husky integration

On install in a git repo, you'll be prompted to wire up a pre-commit hook. To do it later or on a different command:

```bash
npx gitleaks-secret-scanner --setup-husky
npx gitleaks-secret-scanner --setup-husky --command "npx gitleaks-secret-scanner --diff-mode all"
```

If a `.husky/pre-commit` hook already exists, the Gitleaks command is appended, not replaced.

## CI/CD

**GitHub Actions** (scans only the files changed in a PR):

```yaml
on:
  pull_request:
    branches: [main]
jobs:
  gitleaks-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - run: npx gitleaks-secret-scanner-new --diff-mode ci --html-report scan-report.html
        env:
          BASE_SHA: ${{ github.event.pull_request.base.sha }}
          HEAD_SHA: ${{ github.event.pull_request.head.sha }}
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: gitleaks-scan-report, path: scan-report.html }
```

**GitLab CI:**

```yaml
secret-scan-mr:
  image: node:lts
  variables:
    BASE_SHA: ${CI_MERGE_REQUEST_DIFF_BASE_SHA}
    HEAD_SHA: ${CI_COMMIT_SHA}
  script:
    - npx gitleaks-secret-scanner-new --diff-mode ci --html-report scan-report.html
  artifacts:
    when: always
    paths: [scan-report.html]
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
```

## Uninstalling

```bash
npm uninstall gitleaks-secret-scanner-new
```

npm can't run cleanup hooks on uninstall, so cached binaries survive removal. Delete them manually:

```bash
rm -rf ~/.gitleaks-cache
```

## Development

Requires Node.js >= 20.

```bash
npm run build     # compile TypeScript (src/ -> dist/)
npm test          # run the test suite
npm run check     # lint, typecheck, security and dependency checks via PR CheckMate
npm run changelog  # regenerate CHANGELOG.md from conventional commits
```

Every PR is tested on Ubuntu and Windows (`.github/workflows/pr-gate.yml`), including a smoke test that downloads and runs the real platform-specific Gitleaks binary — not just the unit tests, which don't touch the underlying archive format or executable.

## Known limitations

Unknown or misspelled flags (e.g. `--verrbose`) are passed through to Gitleaks rather than rejected, since the parser intentionally allows any native Gitleaks flag.

## License

MIT. This package wraps the [Gitleaks](https://github.com/gitleaks/gitleaks) engine (MIT License, © Zachary Rice), which is not affiliated with or endorsed by this project.
