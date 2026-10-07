# Release and benchmark notes

BlazePlot releases are driven by pull requests into `main`. Tags are outputs of the release workflow, not inputs.

## Branches

`main` is the stable line. Feature, fix, and docs pull requests (including from forks) target it and are squash-merged. A release is a pull request from a `release/vX.Y.Z` branch that bumps `package.json`; merging it publishes that version to npm `latest`.

## Site previews

GitHub Pages publishes the website built from `main`:

- Site: <https://blazeplot.cervelli.dev/>
- Integrated previews: <https://blazeplot.cervelli.dev/previews>
- Links to the old `/next/` site redirect to the same page at the root.
- Legacy `previews.html` index is not generated; use the app preview routes directly.

The release workflow deploys Pages once per push to `main`: immediately for ordinary merges, and after the new tag exists for releases. The site is built from `main` at the root on every deploy, so website changes (docs, demos, benchmark pages) ship without a library release. The site can document behavior that is on `main` but not yet on npm; changelogs and the migration guide state which version introduced a change. Legacy preview routes redirect to the integrated `#previews` view.

Feature branch browser previews can be requested by maintainers with the `Cloudflare Pages Preview` manual GitHub Actions workflow. The workflow deploys the selected feature branch's website build to the `blazeplot` Pages project and exposes a branch alias:

- `https://<branch-alias>.blazeplot.pages.dev/`

Cloudflare lowercases aliases and replaces non-alphanumeric branch characters with hyphens, so `fix/idempotent-chart-start` becomes:

- `https://fix-idempotent-chart-start.blazeplot.pages.dev/`

Preview deploys are manual so that pushing commits to arbitrary PRs does not create Cloudflare deployments.

Release PR checklist: [Internal release checklist](./internal/release-checklist.md). Workflow ownership and failure modes: [GitHub workflow runbook](./internal/github-workflows.md).

## Preparing a release

```bash
git checkout main
git pull --ff-only
git checkout -b release/vX.Y.Z
bun run release patch      # or minor / major
```

The command bumps `package.json`, drafts `changelogs/vX.Y.Z.md` from the commits since the last stable tag, and regenerates `dist/`, `docs/api-reference.md`, and the README docs block. Edit the changelog, commit, and open a PR to `main`. The PR's `validate` check must pass, then squash-merge it.

## What the release workflow does

On every push to `main` and on manual dispatch, `.github/workflows/release.yml` runs the steps below. Only stable `x.y.z` versions on `main` are published (npm `latest`). A prerelease version (for example `2.0.0-rc.1`) or any other branch is skipped with a notice, so a prerelease never takes the `latest` dist-tag.

1. Reads `package.json` and computes `vX.Y.Z`. If that tag already exists, skips straight to the Pages deploy; pull requests already passed CI on an up-to-date branch.
2. Verifies the npm version is unpublished.
3. Runs the full CI workflow as a gate before publishing.
4. Appends benchmark tables to the changelog (`bun run release:benchmarks -- --if-missing`) so the release notes include them.
5. Packs and publishes to npm with provenance via trusted publishing.
6. Creates the `vX.Y.Z` tag and GitHub Release.
7. Deploys GitHub Pages once, so the stable site moves to the new tag.

## Benchmark and bundle-size commands

- `bun run docs:readme`: rebuilds the package, regenerates `docs/api-reference.md` from `dist/`, and refreshes the generated README docs section.
- `bun run test:bundle-size`: checks built package chunk budgets.
- `bun run docs:bundle-size`: prints the bundle-size markdown summary for the current `dist/` build.
- `bun run bundle:analyze`: reports built chunk raw/gzip sizes and source-map generated-byte contributors for investigating bundle growth. Hidden source maps stay in local `dist/` builds for this command; `.map` files are excluded from the published npm package to keep tarballs small.
- `bun run bench:ci`: smoke benchmark used by CI. It checks that the scene renders and asserts no timings.
- `bun run bench:gate` and `bun run bench:gate:canvas2d`: performance regression gates used by CI, one per engine (see [Performance regression gate](#performance-regression-gate)).
- `bun run bench:compare`: manual-only headed comparison benchmark for BlazePlot (WebGL2 and Canvas 2D), uPlot, and Chart.js (18 scenarios, median of 7 fresh-page runs per scenario and library, at least 5 required). It runs unattended after launch and overwrites `benchmarks/latest.json` plus `benchmarks/latest.md`. Only a headed browser on a real GPU produces a publishable result. `bun run bench:compare:smoke` is a headless software-GL self-test of the harness that writes to `build/compare-smoke/`.
- `bun run bench:multi [--charts 50] [--renderers webgl2,shared,canvas2d]`: many-live-charts benchmark comparing one WebGL context per chart, a shared context, and Canvas 2D (see [Shared render context](./internal/shared-render-context.md)). `bun run bench:scatter` profiles scatter sampling in Node.
- `bun run test:visual`: browser visual chart tests used by CI; runs each case with the WebGL2, shared-context, Canvas 2D, and default-`"auto"`-without-WebGL renderers, fails on blank canvases, on pixel differences from the committed baselines in `tests/browser/visual/baselines/`, and on cross-engine parity differences (see [Local development](./internal/local-development.md#cross-engine-parity)); writes PNGs, diffs, and `summary.json` to `build/visual-tests/`. Regenerate baselines with `-- --update-baselines` using the CI procedure in [Local development](./internal/local-development.md#visual-pixel-baselines).
- `bun run test:interaction` and `bun run test:interaction:canvas2d` (also `bun run test:a11y:canvas2d`): browser input automation used by CI, on both engines, for hover, crosshair, zoom, pan, reset, selection, keyboard accessibility, forced colors (high-contrast emulation), drag arbitration, `touch-action`, cooperative gestures, linked charts, charts in iframes, mobile long press, lifecycle, render loops, and live follow. `bun run test:forced-colors` runs just the forced-colors case.
- `bun run test:a11y`: axe-core checks of every built-in plugin's DOM; fails on serious or critical violations (part of `test:browser`).
- `bun run test:cross-browser`: Playwright Firefox and WebKit smoke test (WebGL2, non-blank render, basic interaction, then the same on the Canvas 2D engine, which needs no WebGL) used by the `cross-browser` CI job. See [Browser support](./browser-support.md#tested-browsers).
- `bun run test:stability` and `bun run test:stability:canvas2d`: real-browser leak and stability tests used by CI (chart mount/unmount, resize and series churn, streaming memory at ring-buffer capacity, WebGL context loss/restore; the Canvas 2D run skips the WebGL-only cases). Add `--long` for the local soak. See `docs/internal/local-development.md`.
- `bun run bench -- --scenario <name>`: run one benchmark scenario and print JSON.
- `bun run bench:report`: append benchmark tables to `docs/internal/benchmark-results.md` or a path passed with `--out-md`.
- `bun run release:benchmarks`: append benchmark tables to `changelogs/v<package.version>.md` (the release workflow runs this; rarely needed locally).

Package and API checks that run in `bun run check`: `bun run lint`, `bun run test:coverage` (coverage floors), `bun run test:docs-snippets`, `bun run test:exports`, `bun run test:package`, `bun run test:api` (compares `dist/**/*.d.ts` with `api/public-api.md`; after an intentional API change run `bun run build && bun run test:api -- --update`), and `bun run test:bundle-size`. `bun run test:typescript-floor` is a separate CI job.

Browser detection checks `BLAZEPLOT_BENCH_CHROME`, `CHROME_PATH`, then common Chrome/Chromium/Brave binaries. The benchmark scripts launch Chrome with software WebGL (SwiftShader) so results match CI; set `BLAZEPLOT_REAL_GPU=1` to use the real GPU instead (the SwiftShader flags are dropped and the frame-rate limit is disabled), and `BLAZEPLOT_CHROME_FLAGS` to append browser flags. Real-GPU numbers are not comparable with CI numbers and must not be used to update `benchmarks/thresholds.json`.

## Performance regression gate

`bun run bench:gate` (part of `bun run test:browser`, so it runs in the CI `browser` job) fails a pull request when a deterministic benchmark scene gets markedly slower or does markedly more work. It catches roughly 2x regressions on shared CI runners, not small drifts, and does not replace the manual public comparison benchmark.

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

- **Machine normalisation.** Before and after measuring, the page runs a fixed single-thread calibration workload (262,144 typed-array writes with `Math.sin`, then a bucketed min/max scan, 7 runs each time; the median is used). Time metrics are divided by it, so the gate compares a ratio measured in one browser session, not absolute milliseconds. Across 12 runners sampled while tuning (AMD EPYC 7763, 9V45, 9V74 and Intel Xeon 8370C, 8573C, 6973P) the calibration time varied by about 1.5x to 2x, while the runner-to-runner spread of the median was about 1.1x for `ingestRatio`, 1.2x to 1.3x for `frameP50Ratio` (the Xeon 6973P hosts were consistently the highest, up to 1.34x the baseline), and 1.2x to 1.3x for `frameP95Ratio`.
- **Repetitions and median.** One discarded warmup repetition, then 5 measured repetitions; each metric is the median over the repetitions, so one slow repetition does not matter.
- **Retry before failing.** If any metric exceeds its limit, 5 more repetitions run and the median is taken over all 10 before the gate fails.
- **Deterministic counts.** Draw calls, points, and upload bytes are identical (up to a few points of pan-position jitter) on every runner, so they use tight headroom.
- **Timer resolution.** `frameMs` samples are quantised to 0.1 ms in this configuration, so frame metrics are medians and percentiles over roughly 70 to 150 frames per repetition rather than single readings.

### Thresholds

`benchmarks/thresholds.json` stores, for each metric, a `baseline` (median measured on GitHub-hosted `ubuntu-24.04` runners) and a `headroom` multiplier; the gate fails when the median exceeds `baseline * headroom`. `defaultHeadroom` is 1.8 for the noisier normalised metrics and `frameP50Ratio` uses 1.7; the deterministic count metrics use 1.15 to 1.2. Validation on 8 more runners: the unmodified gate passed on the first attempt on every runner (worst `frameP50Ratio` 1.34x baseline, worst `frameP95Ratio` 1.27x). With `--inject-slowdown-ms 2` (about a 1.9x to 2x slower frame) it failed on every runner, with `frameP50Ratio` at 1.85x to 2.9x baseline; with 1 ms injected (about 1.4x) it failed only on the Xeon 6973P hosts. The gate is tuned to catch slowdowns of about 2x or more in frame CPU work; it does not see smaller ones.

| Metric | Baseline | Headroom | Limit |
|---|---|---|---|
| `frameP50Ratio` | 0.086 | 1.7 | 0.146 |
| `frameP95Ratio` | 0.165 | 1.8 | 0.297 |
| `ingestRatio` | 5.7 | 1.8 | 10.3 |
| `drawCallsP95` | 4 | 1.2 | 4.8 |
| `pointsRenderedP95` | 28,306 | 1.15 | 32,552 |
| `uploadBytesP95` | 226,752 | 1.15 | 260,765 |

`ingestRatio` includes the benchmark's own sample generation, so it is a coarse guard on ingest cost. `drawCallsP95` fails on one extra draw call per frame in this scene, on purpose: draw call count is a direct architectural cost.

### Canvas 2D gate

`bun run bench:gate:canvas2d` (`--renderer canvas2d`) runs the same scenario with `?renderer=canvas2d` and the thresholds under `renderers.canvas2d` in `benchmarks/thresholds.json`, which override the top-level (WebGL2) metrics. The page asserts that the chart ran on the requested engine, and the gate refuses to record numbers from a different one. The Canvas 2D engine uploads nothing, so it has no `uploadBytesP95` metric. Measured on CI runners (10 repetitions, SwiftShader; Canvas 2D is software-rasterized there):

| Metric | Baseline | Headroom | Limit |
|---|---|---|---|
| `frameP50Ratio` | 0.1713 | 1.7 | 0.291 |
| `frameP95Ratio` | 0.585 | 1.8 | 1.053 |
| `ingestRatio` | 5.7 | 1.8 | 10.3 |
| `drawCallsP95` | 4 | 1.2 | 4.8 |
| `pointsRenderedP95` | 28,306 | 1.15 | 32,552 |

A Canvas 2D frame costs about twice the WebGL2 frame on this scene (p50 ratio 0.17 versus 0.087), and its p95 is noisy (0.26 to 0.73 across repetitions) because the page draws only about ten frames per measurement window, so the p95 limit is loose on purpose. Update both gates from CI numbers with `--renderer <name> --update`; the update writes back only that engine's section.

### Hardware assumptions

- Baselines come from GitHub-hosted `ubuntu-24.04` runners (4 vCPU, 16 GB RAM, mixed AMD EPYC and Intel Xeon hosts) with headless Chrome and SwiftShader. Local numbers on a laptop or workstation will differ in absolute terms; the ratio metrics should still land in the same range, but a local run is a sanity check, not the source of truth for updating baselines.
- The scene is CPU-bound. Do not run other heavy work on the machine during a gate run.
- The gate cannot detect GPU-side regressions (shader cost, overdraw); use `bun run bench:compare` on the official machine for those.

### Running and interpreting a failure

```bash
bun run bench:gate                              # compare against benchmarks/thresholds.json
bun run bench:gate -- --report-only             # print the table, never fail
bun run bench:gate -- --reps 11 --retry-reps 0  # more repetitions when investigating noise
bun run bench:gate -- --inject-slowdown-ms 2    # self-test: burns 2 ms per frame, must fail
```

The report lists the median, min..max across repetitions, baseline, limit, and ratio to baseline for each metric, and writes the raw per-repetition data to `build/perf-gate/result.json`. For a failing metric, first re-run the job to see whether it reproduces. If it does, profile with `bun run bench -- --scenario perf-gate` (CPU profile included) against `main`.

### Updating the thresholds

Update `benchmarks/thresholds.json` only when a change intentionally alters performance (for example a new draw call per frame, a different LOD budget, or a speedup that makes the limits too lax), or when the runner hardware class changes. Never raise a limit to make a flaky gate pass; rerun the job and read the log first.

1. Collect CI numbers, not local ones: open a PR (or re-run the `browser` job on it several times) with the change and read the `bench:gate` section of the job log. Every run prints a `Measured baselines` JSON line; take the median across at least 3 runs on different runners.
2. Edit the `baseline` values in `benchmarks/thresholds.json` (or run `bun run bench:gate -- --update` on a CI-class machine to rewrite them from a run). Keep `headroom` values unless the noise analysis changed; if you change them, state the observed spread in the PR.
3. Update the table above, explain the reason in the PR description, and have the change reviewed like any other threshold change.
4. Sanity-check sensitivity with `bun run bench:gate -- --inject-slowdown-ms 2`, which must still fail.

## Public comparison benchmarks

Public comparison numbers are separate from CI smoke benchmarks. `bun run bench:compare` defaults to a headed browser, builds the comparison page as a production bundle, loads every scenario and library pair in a fresh browser context 7 times (at least 5 are required), warms each page up (small charts of the same series type, one discarded full-size setup run, and for pan/stream scenarios a discarded run of the same operation), and reports medians, p95 and spread over the runs. It drives everything through Chrome DevTools Protocol with no user interaction after launch. The latest run is stored in `benchmarks/latest.json` and summarized in `benchmarks/latest.md`; historical comparison artifacts are not kept in-repo apart from the frozen `benchmarks/baseline-before-perf-pass.json`/`.md`, which later reports compare against automatically.

The suite covers BlazePlot (WebGL2 and Canvas 2D), uPlot, and Chart.js across setup (100k and 1M initial render, cold first chart), a 1M line pan, 1M live streaming, a 10M dense-pan stress case (BlazePlot uses its accelerated dataset path there), multi-series, area, scatter, bar and dual-axis pans, hover and resize latency, 50 small charts, mount/destroy cycles, heap growth, and maximum sustained streaming rate. Each scenario reports the winner and the BlazePlot ratio against uPlot and Chart.js, and the report has a "Where BlazePlot does not win" section listing every loss and every result within noise. The fairness rules and metric definitions are in [Benchmark methodology](./internal/benchmarks.md#library-comparison-methodology). Results are marked non-publishable when the browser is headless, the detected WebGL renderer appears to be software-rendered, fewer than 5 runs were taken, the run omits any official scenario/library, any library/scenario run fails, or the libraries' plot areas differ.

When a publishable `benchmarks/latest.json` exists, `bun run docs:readme` generates the README performance section from that file. If that file is missing, the README documents only how to run the manual benchmark and shows no competitor numbers. If the file exists but is non-publishable, docs generation fails instead of silently promoting bad data.

## Reading release benchmark tables

Columns of the compact changelog benchmark table:

- **RAF FPS / RAF p95 ms**: browser animation-frame cadence during the benchmark window.
- **Renderer**: the render mode the chart reported in its frame stats (`ChartFrameStats.renderMode`, for example `mixed`).
- **Chart p50/p95 ms**: `Chart` frame time from internal frame stats.
- **Points**: median rendered primitives/points from `ChartFrameStats.pointsRendered`.
- **Draws**: median draw call count.
- **Upload KB**: median GPU upload size per frame.

The CPU hot-spot table comes from the Chrome DevTools Protocol profiler. It shows large regressions, but exact timings vary by runner and browser, so do not treat them as performance budgets.

## Reading API reference bundle-size tables

The API reference and README bundle-size summary are generated by `bun run docs:readme` from the built `dist/` files. It uses the same budgets as `bun run test:bundle-size` and reports each budgeted chunk's current size and remaining budget.
