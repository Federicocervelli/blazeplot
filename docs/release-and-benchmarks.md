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
- `bun run bench:ci`: fast smoke benchmark used by CI. It only checks that the scene renders; it asserts no timings.
- `bun run bench:gate`: performance regression gate used by CI (see [Performance regression gate](#performance-regression-gate)).
- `bun run bench:compare`: manual-only headed comparison benchmark for BlazePlot, uPlot, and Chart.js. It runs automatically after launch and overwrites `benchmarks/latest.json` plus `benchmarks/latest.md`.
- `bun run test:visual`: browser visual chart tests used by CI; writes PNGs and `summary.json` to `build/visual-tests/`.
- `bun run test:interaction`: browser input automation used by CI for hover, crosshair, zoom, pan, reset, and selection.
- `bun run test:cross-browser`: Playwright Firefox and WebKit smoke test (WebGL2, non-blank render, basic interaction) used by the `cross-browser` CI job. See [Browser support](./browser-support.md#tested-browsers).
- `bun run bench -- --scenario <name>`: run one benchmark scenario and print JSON.
- `bun run bench:report`: append benchmark tables to `docs/internal/benchmark-results.md` or a path passed with `--out-md`.
- `bun run release:benchmarks`: append benchmark tables to `changelogs/v<package.version>.md` (the release workflow runs this; rarely needed locally).

Browser detection checks `BLAZEPLOT_BENCH_CHROME`, `CHROME_PATH`, then common Chrome/Chromium/Brave binaries.

## Performance regression gate

`bun run bench:gate` (part of `bun run test:browser`, so it runs in the CI `browser` job) fails a pull request when a deterministic benchmark scene gets markedly slower or does markedly more work. It exists to catch roughly 2x regressions on shared CI runners, not to track small drifts, and it does not replace the manual public comparison benchmark.

### What it measures

The gate runs the `perf-gate` scenario (`tests/browser/bench/main.ts`): 1M samples of line data plus sparse scatter and bar series, with a 1600x900 viewport panning over a 500k-sample window for 3 seconds. Data and camera path are fixed, so per-frame work does not depend on how many frames a slow runner manages to draw.

Each repetition opens a fresh page in one headless Chrome session (SwiftShader software WebGL, the same flags as `bench:ci`), fills the data, warms up, and measures. The reported metrics are:

| Metric | Meaning | Kind |
|---|---|---|
| `frameP50Ratio` | `ChartFrameStats.frameMs` p50 divided by the calibration time | normalised time |
| `frameP95Ratio` | `ChartFrameStats.frameMs` p95 divided by the calibration time | normalised time |
| `ingestRatio` | time spent in the initial 1M-sample appends divided by the calibration time | normalised time |
| `drawCallsP95` | draw calls per frame | deterministic count |
| `pointsRenderedP95` | points/primitives per frame | deterministic count |
| `uploadBytesP95` | GPU upload bytes per frame | deterministic count |

`frameMs` is the CPU time of one `Chart` render: LOD extraction, buffer uploads, and command submission. With software WebGL the rasterisation runs on other threads and is not included, so the gate is a CPU-work gate. It does not measure GPU performance or visual frame rate (FPS on a software renderer is not meaningful).

### How noise is handled

- **Machine normalisation.** Before and after measuring, the page runs a fixed single-thread calibration workload (262,144 typed-array writes with `Math.sin`, then a bucketed min/max scan, 7 runs each time; the median is used). Time metrics are divided by it, so the gate compares a ratio measured in the same browser session instead of absolute milliseconds. Across 12 runners sampled while tuning (AMD EPYC 7763, 9V45, 9V74 and Intel Xeon 8370C, 8573C, 6973P) the calibration time varied by about 1.5x to 2x, while the runner-to-runner spread of the median was about 1.1x for `ingestRatio`, 1.2x to 1.3x for `frameP50Ratio` (the Xeon 6973P hosts were consistently the highest, up to 1.34x the baseline), and 1.2x to 1.3x for `frameP95Ratio`.
- **Repetitions and median.** One discarded warmup repetition, then 5 measured repetitions; each metric is the median over the repetitions, so a single slow repetition does not matter.
- **Retry before failing.** If any metric exceeds its limit, 5 more repetitions run and the median is taken over all 10 before the gate fails.
- **Deterministic counts.** Draw calls, points, and upload bytes are identical (up to a few points of pan-position jitter) on every runner, so they use tight headroom.
- **Timer resolution.** `frameMs` samples are quantised to 0.1 ms in this configuration, so frame metrics are medians and percentiles over roughly 70 to 150 frames per repetition rather than single readings.

### Thresholds

`benchmarks/thresholds.json` stores, for each metric, a `baseline` (median measured on GitHub-hosted `ubuntu-latest` runners) and a `headroom` multiplier; the gate fails when the median exceeds `baseline * headroom`. `defaultHeadroom` is 1.8 for the noisier normalised metrics and `frameP50Ratio` uses 1.7; the deterministic count metrics use 1.15 to 1.2. Validation on 8 more runners: the unmodified gate passed on the first attempt on every runner (worst `frameP50Ratio` 1.34x baseline, worst `frameP95Ratio` 1.27x). With `--inject-slowdown-ms 2` (about a 1.9x to 2x slower frame) it failed on every runner, with `frameP50Ratio` at 1.85x to 2.9x baseline; with 1 ms injected (about 1.4x) it failed only on the Xeon 6973P hosts. So the gate is tuned to catch slowdowns of about 2x or more in frame CPU work and does not claim to see smaller ones.

| Metric | Baseline | Headroom | Limit |
|---|---|---|---|
| `frameP50Ratio` | 0.086 | 1.7 | 0.146 |
| `frameP95Ratio` | 0.165 | 1.8 | 0.297 |
| `ingestRatio` | 5.7 | 1.8 | 10.3 |
| `drawCallsP95` | 4 | 1.2 | 4.8 |
| `pointsRenderedP95` | 28,306 | 1.15 | 32,552 |
| `uploadBytesP95` | 226,752 | 1.15 | 260,765 |

`ingestRatio` includes the benchmark's own sample generation, so it is a coarse guard on ingest cost rather than a sensitive one. Note that `drawCallsP95` fails on one extra draw call per frame in this scene; that is intended, because draw call count is a direct architectural cost.

### Hardware assumptions

- Baselines come from GitHub-hosted `ubuntu-latest` runners (4 vCPU, 16 GB RAM, mixed AMD EPYC and Intel Xeon hosts) with headless Chrome and SwiftShader. Local numbers on a laptop or workstation will differ in absolute terms; the ratio metrics should still land in the same range, but a local run is a sanity check, not the source of truth for updating baselines.
- The scene is CPU-bound by design. Do not run other heavy work on the machine during a gate run.
- The gate cannot detect GPU-side regressions (shader cost, overdraw); use `bun run bench:compare` on the official machine for those.

### Running and interpreting a failure

```bash
bun run bench:gate                              # compare against benchmarks/thresholds.json
bun run bench:gate -- --report-only             # print the table, never fail
bun run bench:gate -- --reps 11 --retry-reps 0  # more repetitions when investigating noise
bun run bench:gate -- --inject-slowdown-ms 2    # self-test: burns 2 ms per frame, must fail
```

The report lists the median, min..max across repetitions, baseline, limit, and ratio to baseline for each metric, and writes the raw per-repetition data to `build/perf-gate/result.json`. For a failing metric, first re-run the job to see whether it reproduces. If it does, profile with `bun run bench -- --scenario perf-gate` (CPU profile included) against `main` or `v1`.

### Updating the thresholds

Update `benchmarks/thresholds.json` only when a change intentionally alters performance (for example a new draw call per frame, a different LOD budget, or a speedup that makes the limits too lax), or when the runner hardware class changes. Never raise a limit just to make a flaky gate pass; rerun the job and read the log first.

1. Collect CI numbers, not local ones: open a PR (or re-run the `browser` job on it several times) with the change and read the `bench:gate` section of the job log. Every run prints a `Measured baselines` JSON line; take the median across at least 3 runs on different runners.
2. Edit the `baseline` values in `benchmarks/thresholds.json` (or run `bun run bench:gate -- --update` on a CI-class machine to rewrite them from a run). Keep `headroom` values unless the noise analysis changed; if you change them, state the observed spread in the PR.
3. Update the table above, explain the reason in the PR description, and have the change reviewed like any other threshold change.
4. Sanity-check sensitivity with `bun run bench:gate -- --inject-slowdown-ms 2`, which must still fail.

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
