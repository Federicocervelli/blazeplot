# Release and benchmark notes

BlazePlot releases are driven by pull requests into `main`. Tags are outputs of the release workflow, not inputs.

## Branches

`main` is the stable line. Feature, fix, and docs pull requests (including from forks) target it and are squash-merged. A release is a pull request from a `release/vX.Y.Z` branch that bumps `package.json`; merging it publishes that version to npm `latest`.

Until 1.0 ships there is one more long-lived branch, `v1`; see [The v1 branch](#the-v1-branch-10-release-candidates).

## The v1 branch (1.0 release candidates)

`v1` is the integration branch for the 1.0 release candidates. It exists only until 1.0 is released.

- Branch from `v1` for 1.0 work (`feature/<topic>`, `fix/<topic>`, `docs/<topic>`) and open pull requests against `v1`. They are squash-merged like any other PR, and CI (`validate`) runs the same as for `main`.
- Fixes that should also ship before 1.0 as stable patch releases go to `main` first and reach `v1` through the sync below, not by cherry-picking.
- Candidates are `1.0.0-rc.N`. Merging a pull request that bumps `package.json` to `1.0.0-rc.N` into `v1` publishes it to npm with the `rc` dist-tag (`npm i blazeplot@rc`) and creates a GitHub pre-release. It never touches `latest`, never becomes the GitHub "Latest" release, and never deploys Pages.
- The release workflow only publishes `-rc.N` versions from `v1` and only stable versions from `main`. A stable version on `v1` or an rc version on `main` is skipped with a notice.

### Syncing main into v1

Merge `main` into `v1` so `v1` never drifts: at least once a week, immediately after every stable release from `main`, and before cutting each release candidate.

```bash
git fetch origin
git checkout -b sync/main-into-v1-YYYY-MM-DD origin/v1
git merge origin/main      # resolve conflicts here
git push -u origin HEAD    # open a PR with base v1
```

- Land sync PRs with **Create a merge commit**, not squash, so history records what is already merged and later syncs stay small.
- When `package.json` conflicts, keep `v1`'s `1.0.0-rc.N` version. Do not keep a changelog from `main` that duplicates an rc one.
- If the merge brings a stable `package.json` version into `v1` (because `v1` has no rc bump yet), nothing publishes; the release workflow skips stable versions on `v1`.

### Shipping 1.0

1. Sync `main` into `v1` one last time and cut the last candidate.
2. On a `release/v1.0.0` branch from `v1`, run `bun run release 1.0.0` and open a PR with base `v1` for the version and changelog.
3. Open a PR from `v1` to `main` and land it with **Create a merge commit**. The push to `main` runs the normal stable release, publishing `1.0.0` to `latest` and deploying Pages.
4. Delete `v1`, remove it from the workflow triggers and CI branch filter, and restore the single-branch policy in the docs.

## Site previews

GitHub Pages publishes two builds into one site:

- Stable site, built from the latest release tag: <https://blazeplot.cervelli.dev/>
- Stable integrated previews: <https://blazeplot.cervelli.dev/previews>
- Unreleased `main` site: <https://blazeplot.cervelli.dev/next/>
- Unreleased integrated previews: <https://blazeplot.cervelli.dev/next/previews>
- Legacy `previews.html` index is not generated; use the app preview routes directly.

The release workflow deploys Pages once per push to `main`: immediately for ordinary merges, and after the new tag exists for releases. The Pages workflow builds the latest `v*` tag and `main` with the correct Vite `base`, then deploys a combined artifact. Legacy preview routes redirect to the integrated `#previews` view.

Feature branch browser previews can be requested by maintainers with the `Cloudflare Pages Preview` manual GitHub Actions workflow. The workflow deploys the selected feature branch's website build to the `blazeplot` Pages project and exposes a branch alias:

- `https://<branch-alias>.blazeplot.pages.dev/`

Cloudflare lowercases aliases and replaces non-alphanumeric branch characters with hyphens, so `fix/idempotent-chart-start` becomes:

- `https://fix-idempotent-chart-start.blazeplot.pages.dev/`

Preview deploys are intentionally manual so arbitrary PRs do not create Cloudflare deployments just by pushing commits.

For a copy-paste release PR checklist, see [Internal release checklist](./internal/release-checklist.md). For workflow ownership and failure modes, see [GitHub workflow runbook](./internal/github-workflows.md).

## Preparing a release

```bash
git checkout main
git pull --ff-only
git checkout -b release/vX.Y.Z
bun run release patch      # or minor / major
```

The command bumps `package.json`, drafts `changelogs/vX.Y.Z.md` from the commits since the last stable tag, and regenerates `dist/`, `docs/api-reference.md`, and the README docs block. Edit the changelog, commit, and open a PR to `main`. The PR's `validate` check must pass, then squash-merge it.

## Preparing a release candidate

Release candidates are cut from `v1`, after syncing `main` into it:

```bash
git fetch origin
git checkout -b release/v1.0.0-rc.N origin/v1
bun run release 1.0.0-rc.1   # first candidate; afterwards: bun run release rc
```

`bun run release rc` bumps `x.y.z-rc.N` to `x.y.z-rc.N+1`; an explicit `x.y.z-rc.N` or `x.y.z` version is also accepted but must be greater than the current one. Add `--dry-run` to print the planned version and changelog without writing anything. Candidate changelogs list commits since the last tag of any kind. Edit the changelog, commit, and open a PR with base `v1`.

## What the release workflow does

On every push to `main` or `v1` and on manual dispatch, `.github/workflows/release.yml` runs the steps below. `main` publishes only stable `x.y.z` versions (npm `latest`); `v1` publishes only `x.y.z-rc.N` versions (npm `rc`, GitHub pre-release, no Pages deploy). Other combinations are skipped with a notice.

1. Reads `package.json` and computes `vX.Y.Z[-rc.N]`. If that tag already exists, skips straight to the Pages deploy (`main` only); pull requests already passed CI on an up-to-date branch.
2. Verifies the npm version is unpublished.
3. Runs the full CI workflow as a gate before publishing.
4. Appends benchmark tables to the changelog (`bun run release:benchmarks -- --if-missing`) so the release notes include them.
5. Packs and publishes to npm with provenance via trusted publishing.
6. Creates the `vX.Y.Z` tag and GitHub Release.
7. On `main` only, deploys GitHub Pages once, so the stable site moves to the new tag.

## Benchmark and bundle-size commands

- `bun run docs:readme`: rebuilds the package, regenerates `docs/api-reference.md` from `dist/`, and refreshes the generated README docs section.
- `bun run test:bundle-size`: enforces built package chunk budgets.
- `bun run docs:bundle-size`: prints the bundle-size markdown summary for the current `dist/` build.
- `bun run bundle:analyze`: reports built chunk raw/gzip sizes and source-map generated-byte contributors for investigating bundle growth. Hidden source maps remain in local `dist/` builds for this command, but `.map` files are excluded from the published npm package to keep tarballs small.
- `bun run bench:ci`: fast smoke benchmark used by CI.
- `bun run bench:compare`: manual-only headed comparison benchmark for BlazePlot, uPlot, and Chart.js. It runs automatically after launch and overwrites `benchmarks/latest.json` plus `benchmarks/latest.md`.
- `bun run test:visual`: browser visual chart tests used by CI; writes PNGs and `summary.json` to `build/visual-tests/`.
- `bun run test:interaction`: browser input automation used by CI for hover, crosshair, zoom, pan, reset, and selection.
- `bun run bench -- --scenario <name>`: run one benchmark scenario and print JSON.
- `bun run bench:report`: append benchmark tables to `docs/internal/benchmark-results.md` or a path passed with `--out-md`.
- `bun run release:benchmarks`: append benchmark tables to `changelogs/v<package.version>.md` (the release workflow runs this; rarely needed locally).

Browser detection checks `BLAZEPLOT_BENCH_CHROME`, `CHROME_PATH`, then common Chrome/Chromium/Brave binaries.

## Public comparison benchmarks

Public comparison numbers are intentionally separate from CI smoke benchmarks. `bun run bench:compare` defaults to a headed browser, prewarms each selected library with a dense chart after module load, runs one discarded setup warmup per library/scenario, drives every measured scenario through Chrome DevTools Protocol, and requires no user interaction after the command starts. The latest run is stored in `benchmarks/latest.json` and summarized in `benchmarks/latest.md`; historical comparison artifacts are not kept in-repo.

The comparison suite currently covers BlazePlot, uPlot, and Chart.js across 100k/1M static line setup, 1M pan over a 100k visible window, 1M live streaming append while following the latest 100k samples, and a 10M dense-pan stress case with 5M visible samples. The 10M case intentionally uses BlazePlot's best-practice accelerated dataset path while competitors use their recommended array inputs. Results are marked non-publishable when the browser is headless, the detected WebGL renderer appears to be software-rendered, the run omits any official scenario/library, or any library/scenario run fails.

When a publishable `benchmarks/latest.json` exists, `bun run docs:readme` generates the README performance section from that file. If that file is missing, the README only documents how to run the manual benchmark and avoids public competitor numbers. If the file exists but is non-publishable, docs generation fails instead of silently promoting bad data.

## Reading release benchmark tables

The changelog benchmark table is intentionally compact:

- **RAF FPS / RAF p95 ms**: browser animation-frame cadence during the benchmark window.
- **Chart p50/p95 ms**: `Chart` frame time from internal frame stats.
- **Points**: median rendered primitives/points from `ChartFrameStats.pointsRendered`.
- **Draws**: median draw call count.
- **Batched**: median draw calls avoided by compatible internal batching.
- **Upload KB**: median GPU upload size per frame.

The CPU hot-spot table comes from the Chrome DevTools Protocol profiler. It is useful for spotting large regressions, but exact timings vary by runner/browser and should not be treated as strict performance budgets yet.

## Reading API reference bundle-size tables

The API reference and README bundle-size summary are generated by `bun run docs:readme` from the built `dist/` files. It uses the same budgets as `bun run test:bundle-size`, reports the current size for each budgeted chunk, and shows how much budget remains for each chunk.
