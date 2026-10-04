# Local development runbook

This runbook collects the commands maintainers use most often while changing BlazePlot. It is intentionally operational: copy the command, run it, and know what it proves.

Related workflow reference: [GitHub workflow runbook](./github-workflows.md).

## Setup

```bash
bun install
bun run typecheck
bun test
```

Use Bun for repo work. `packageManager` pins the expected Bun version; CI also uses that version.

## Daily development loop

| Goal | Command | Notes |
|---|---|---|
| Type-check all source, tests, scripts, and website code | `bun run typecheck` | Fastest broad correctness check. |
| Lint with Oxlint | `bun run lint` | Correctness rules only; config in `.oxlintrc.json`. Included in `bun run check`. |
| Run unit tests | `bun test` | Covers datasets, render helpers, interactions, and data export helpers. |
| Run unit tests with coverage floors | `bun run test:coverage` | Runs `bun test --coverage` via `scripts/coverage-check.ts` and fails if `src/core`, overall `src/`, the built-in plugin implementations (`src/ui` plugins and linked charts), or the public entry barrels (`src/index.ts`, `src/linked.ts`, `src/plugins/*`) drop below the line/function floors in that script. Included in `bun run check`. Floors sit just under the baseline (core ~94% lines, `src/` ~90%, plugins ~98%, public API 100%, excluding browser-only `theme.ts`); raise them when coverage improves, never lower them. Plugin tests live in `tests/ui` and run under happy-dom with the fake GPU backend; drawing that needs a real WebGL2 or 2D canvas (`WebGL2Backend`, screenshot compositing, flame graph pixels) stays in `bun run test:browser`. |
| Build the library package | `bun run build` | Emits `dist/` and declarations. |
| Build only JS output | `bun run build:js` | Useful before bundle analysis when declarations are irrelevant. |
| Run the docs/site dev server | `bun run dev` | Serves the Lit documentation site. |
| Serve browser test fixtures | `bun run fixtures:dev` | Serves `tests/browser/` for debugging visual, interaction, and benchmark pages. |
| Preview the built docs/site | `bun run pages:build && bun run pages:preview` | Mirrors the GitHub Pages build. |

## Browser-backed checks

Visual, interaction, and benchmark checks need Chrome/Chromium/Brave. The scripts check `BLAZEPLOT_BENCH_CHROME`, then `CHROME_PATH`, then common browser binaries.

```bash
export BLAZEPLOT_BENCH_CHROME=/path/to/chrome
bun run test:visual
bun run test:interaction
bun run test:website
bun run bench:ci
```

`bun run test:website` checks the development and production website builds for routing, responsive previews, modal keyboard behavior, copy/export feedback, lazy loading, offscreen chart lifecycle, and legend focus in headless Chromium. Screenshots and test downloads are written to `build/website-ux/`. Run a focused case with `bun scripts/website-ux-test.ts <case>` (for example, `anchors` or `legend`). After `bun run pages:build`, run `bun scripts/website-ux-test.ts production` to smoke-test the built site.

### Cross-browser smoke (Firefox and WebKit)

`bun run test:cross-browser` uses Playwright to run a smoke test in Firefox and WebKit against the Vite-served visual and interaction fixtures. For each browser it checks that WebGL2 is available, that visual cases render non-blank pixels (page screenshot plus `chart.screenshot()`), that WebGL context restore works, and that hover, crosshair, wheel zoom, shift-drag pan, box zoom, and double-click reset work. It starts its own Vite server and does not need Chrome.

```bash
bunx playwright install firefox webkit      # once; add --with-deps on Linux
bun run test:cross-browser
bun run test:cross-browser --browsers webkit --cases line,scatter
```

Screenshots and `summary.json` go to `build/cross-browser/` (failures add `*-FAILED.png`). Options are listed by `bun run test:cross-browser --help`.

- A browser without WebGL2 fails the run. To skip one on purpose, list it in `--allow-no-webgl2` or `BLAZEPLOT_CROSS_BROWSER_ALLOW_NO_WEBGL2`; the run then prints a `SKIP` line and the browser's other checks do not run. Document any allowlist entry in `docs/browser-support.md`.
- On Linux CI, headless Firefox cannot find a GL driver, so the job runs it headed under Xvfb (`xvfb-run -a bun run test:cross-browser --headed firefox`) and gets Mesa llvmpipe WebGL2. Locally on a desktop, plain headless works if your GPU drivers expose WebGL2.
- WebKit on Windows and Linux is the Playwright build, not Safari.

CI runs the same groups as separate jobs. Locally:

```bash
bun run check          # typecheck, unit tests, build, docs freshness, package checks
bun run test:browser   # benchmark smoke, visual, interaction, website (needs Chrome)
bun run ci             # both (cross-browser is a separate CI job: bun run test:cross-browser)
```

## Documentation changes

When docs mention public APIs, verify names against source, tests, or generated declarations. Complete examples should include imports and cleanup.

Run these when generated docs, README links, website routing, or examples change:

```bash
bun run docs:readme
bun run pages:build
```

`bun run docs:readme` rebuilds `dist/`, regenerates `docs/api-reference.md`, and refreshes the generated README docs block.

## Package checks

Run package checks before changing exports, files, build config, package metadata, or release behavior:

```bash
bun run test:exports
bun run test:package
bun run test:api
bun run test:bundle-size
```

`bun run test:api` compares the exported names and signatures in `dist/**/*.d.ts` (for every `package.json#exports` entry, comments and private members ignored) with the committed snapshot `api/public-api.md`. It needs a fresh `bun run build` first. When it fails, read the printed `-`/`+` lines: if the public API change is intentional, run `bun run build && bun run test:api -- --update` and commit the regenerated `api/public-api.md` in the same PR; if not, fix the source. The snapshot also lists types that public signatures reference but no entry point exports. Never hand-edit `api/public-api.md`.

Use `bun run docs:bundle-size` to print the current bundle-size table and `bun run bundle:analyze` when a chunk grows unexpectedly.

## Release candidate checklist

Release commands and branch policy live in [Release and benchmark notes](../release-and-benchmarks.md), with a copy-paste checklist in [Release checklist](./release-checklist.md). The short version:

1. Create a `release/vX.Y.Z` branch from updated `main`.
2. Run `bun run release patch` (or `minor` / `major`): bumps the version, drafts the changelog, and regenerates docs.
3. Edit `changelogs/vX.Y.Z.md` and commit.
4. Open the release PR to `main` and squash-merge it.
