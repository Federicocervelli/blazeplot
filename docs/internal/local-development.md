# Local development runbook

This runbook collects the commands maintainers use most often while changing BlazePlot. It is intentionally operational: copy the command, run it, and know what it proves.

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
| Build the library package | `bun run build` | Emits `dist/` and declarations. |
| Build only JS output | `bun run build:js` | Useful before bundle analysis when declarations are irrelevant. |
| Run the docs/site dev server | `bun run dev` | Serves the Lit documentation site. |
| Preview the built docs/site | `bun run pages:build && bun run pages:preview` | Mirrors the GitHub Pages build. |

## Browser-backed checks

Visual, interaction, and benchmark checks need Chrome/Chromium/Brave. The scripts check `BLAZEPLOT_BENCH_CHROME`, then `CHROME_PATH`, then common browser binaries.

```bash
export BLAZEPLOT_BENCH_CHROME=/path/to/chrome
bun run test:visual
bun run test:interaction
bun run bench:ci
```

`bun run ci` runs the full validation suite used by pull requests:

```bash
bun run typecheck
bun test
bun run build
bun run test:exports
bun run test:package
bun run test:bundle-size
bun run bench:ci
bun run test:visual
bun run test:interaction
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

1. Branch from updated `development`.
2. Bump with `bun run version:patch`, `version:minor`, or `version:major`.
3. Update `changelogs/vX.Y.Z.md`.
4. Run `bun run release:benchmarks`.
5. Run `bun run docs:readme`.
6. Run `bun run ci`, `bun run pages:build`, and `bun pm pack --dry-run`.
7. Open the release PR from `development` to `main`.
