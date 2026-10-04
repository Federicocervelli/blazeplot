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
| Run unit tests | `bun test` | Covers datasets, render helpers, interactions, and data export helpers. |
| Run unit tests with coverage floors | `bun run test:coverage` | Runs `bun test --coverage` via `scripts/coverage-check.ts` and fails if `src/core` or overall `src/` line/function coverage drops below the floors in that script. Included in `bun run check`. Floors sit just under the baseline (core ~93% lines, `src/` ~79% lines excluding browser-only `theme.ts`/`OverlayUtils.ts`); raise them when coverage improves, never lower them. |
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

CI runs the same two groups as separate jobs. Locally:

```bash
bun run check          # typecheck, unit tests, build, docs freshness, package checks
bun run test:browser   # benchmark smoke, visual, interaction, website (needs Chrome)
bun run ci             # both
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
bun run test:bundle-size
```

Use `bun run docs:bundle-size` to print the current bundle-size table and `bun run bundle:analyze` when a chunk grows unexpectedly.

## Release candidate checklist

Release commands and branch policy live in [Release and benchmark notes](../release-and-benchmarks.md), with a copy-paste checklist in [Release checklist](./release-checklist.md). The short version:

1. Create a `release/vX.Y.Z` branch from updated `main`.
2. Run `bun run release patch` (or `minor` / `major`): bumps the version, drafts the changelog, and regenerates docs.
3. Edit `changelogs/vX.Y.Z.md` and commit.
4. Open the release PR to `main` and squash-merge it.
