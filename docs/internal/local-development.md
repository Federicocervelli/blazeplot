# Local development runbook

Commands maintainers use most often while changing BlazePlot. Workflow reference: [GitHub workflow runbook](./github-workflows.md).

## Setup

```bash
bun install
bun run typecheck
bun test
```

Use Bun. `packageManager` pins the Bun version, and CI uses the same one.

## Daily development loop

| Goal | Command | Notes |
|---|---|---|
| Type-check all source, tests, scripts, and website code | `bun run typecheck` | Fastest broad check. |
| Lint with Oxlint | `bun run lint` | Correctness rules only; config in `.oxlintrc.json`. Included in `bun run check`. |
| Check the import graph | `bun run test:imports` | Fails on any import cycle (type-only imports included) or layering violation in `src/` (see `scripts/import-graph.ts`). Included in `bun run check`. |
| Run unit tests | `bun test` | Covers datasets, render helpers, interactions, and data export helpers. |
| Run unit tests with coverage floors | `bun run test:coverage` | Runs `bun test --coverage` via `scripts/coverage-check.ts` and fails if `src/core`, overall `src/`, the built-in plugin implementations (`src/plugins/*/` and `src/linked/`), or the public entry barrels (`src/index.ts`, `src/linked.ts`, `src/plugins/*`) drop below the line/function floors in that script. Included in `bun run check`. Floors sit just under the baseline (core ~94% lines, `src/` ~90%, plugins ~98%, public API 100%, excluding browser-only `theme.ts`); raise them when coverage improves, never lower them. Plugin tests live in `tests/ui` and run under happy-dom with the fake GPU backend; drawing that needs a real WebGL2 or 2D canvas (`WebGL2Backend`, screenshot compositing, flame graph pixels) stays in `bun run test:browser`. |
| Build the library package | `bun run build` | Emits `dist/` and declarations. |
| Build only JS output | `bun run build:js` | Use before bundle analysis, when declarations are irrelevant. |
| Run the docs/site dev server | `bun run dev` | Serves the Lit documentation site. |
| Serve browser test fixtures | `bun run fixtures:dev` | Serves `tests/browser/` for debugging visual, interaction, and benchmark pages. |
| Preview the built docs/site | `bun run pages:build && bun run pages:preview` | Mirrors the GitHub Pages build. |

## Browser-backed checks

Visual, interaction, stability, and benchmark checks need Chrome, Chromium, or Brave. The scripts check `BLAZEPLOT_BENCH_CHROME`, then `CHROME_PATH`, then common browser binaries.

```bash
export BLAZEPLOT_BENCH_CHROME=/path/to/chrome
bun run test:visual
bun run test:interaction   # includes the forced-colors case; `-- --case <name>` runs one case
bun run test:forced-colors # forced-colors emulation only; screenshots in build/visual-tests/forced-colors/
bun run test:a11y   # axe-core on the chart DOM; fails on serious or critical violations
bun run test:stability
bun run test:website
bun run bench:ci
bun run bench:gate
```

By default every script launches Chrome with software WebGL (SwiftShader) so results match CI. To exercise a real GPU, set `BLAZEPLOT_REAL_GPU=1`: the SwiftShader flags are dropped and `--disable-frame-rate-limit` is added (a headless GPU-backed page is otherwise throttled to about 10 rAF/s). `BLAZEPLOT_CHROME_FLAGS="--flag --other=1"` appends extra browser flags. On Windows, a Playwright-installed Chromium under a packaged-app profile can fail with "Sandbox cannot access executable"; copy the `chrome-win64` folder to an ordinary path and point `BLAZEPLOT_BENCH_CHROME` at it. Pixel baselines are compared only on Linux, so a real-GPU run checks behaviour, not pixels. Verify the renderer with `WEBGL_debug_renderer_info` (it should name your GPU, not SwiftShader); `bun run bench:compare` records it in `benchmarks/latest.md`.

`bun run test:stability` is the real-browser leak and stability suite (`scripts/stability-test.ts`, fixture in `tests/browser/stability/`). It runs these cases, each on a fresh page:

| Case | What it does | What must hold |
|---|---|---|
| `mount-unmount` | Mounts and disposes full-plugin charts (and flame graphs) hundreds of times, hovering each one. | After a forced GC (`HeapProfiler.collectGarbage`) JS heap, DOM nodes, documents, and JS event listeners are back at the post-warm-up baseline within tolerance. The page's own counters are exact: no leftover elements, canvases, live WebGL objects, or live (not lost) WebGL contexts. |
| `resize-churn` | One chart, repeated host resizes and `resize(dpr)` calls. | Same baseline checks. |
| `series-churn` | One chart, repeatedly adding and removing line/area/scatter/bar series. | Same baseline checks, including live WebGL buffers. |
| `streaming` | Multi-series stream into ring buffers at capacity with plugins and hover. | Buffers hold exactly their capacity, heap does not grow with samples streamed (bounded growth, plus a trend check in `--long`), no new DOM, listeners, or GL objects. |
| `context-loss` | `WEBGL_lose_context` lose/restore cycles, including appends and hover while lost and dispose while lost. | Chart renders non-blank frames after every restore; no renders while lost; nothing left behind. |
| `shared-context` | Mounts and disposes batches of 25 charts that share one `sharedRenderer()` context (200 charts in the CI profile, 1,000 with `--long`). | Same baseline checks, and no more than one live WebGL context at any time. |
| `shared-context-loss` | Loses and restores the shared context repeatedly with three charts attached, then disposes them while it is lost. | Every chart paints again after each restore; nothing left behind. |
| `detector-control` | Retains charts on purpose. | The same counters must move, then return to baseline after release. Proves the checks can fail. |

Any page exception, `console.error`, or browser "Too many active WebGL contexts" warning also fails a case.

```bash
bun run test:stability                      # CI mode, about a minute
bun run test:stability --long               # local soak: 1,000+ iterations, 90s streaming run
bun run test:stability --long --duration-s 300   # longer streaming window
bun run test:stability --case streaming --verbose  # one case, print every heap/DOM sample
bun run test:stability:canvas2d             # the same suite on the Canvas 2D engine (skips the WebGL-only cases)
```

`--verbose` prints each post-GC sample; `build/stability/report.json` records all measurements. Tolerances live in `scripts/stability-test.ts` (`toleranceFor`, the streaming limits). When the suite fails, read the message first: it names the counter that moved and the baseline and final values. Reproduce with `--case <name> --verbose`, then bisect by removing plugins from `fullPlugins()` in the fixture. Do not loosen a tolerance to make a failure pass; a real leak grows with iterations, so run `--long` and check whether the number scales.

`bun run test:website` checks the development and production website builds for routing, responsive previews, modal keyboard behavior, copy/export feedback, lazy loading, offscreen chart lifecycle, and legend focus in headless Chromium. Screenshots and test downloads are written to `build/website-ux/`. Run a focused case with `bun scripts/website-ux-test.ts <case>` (for example, `anchors` or `legend`). After `bun run pages:build`, run `bun scripts/website-ux-test.ts production` to smoke-test the built site.

### Visual pixel baselines

`bun run test:visual` renders each case in headless Chrome and checks two more things:

1. **Blank-canvas guard (every case).** After the draw-call assertions, the grid is hidden and the plot canvas (or the flamegraph canvas) is captured. A case fails when the fraction of pixels that differ from the border background color is below its `minInkRatio` in `CASE_CHECKS` (`scripts/visual-test.ts`). This catches draws that never reach the canvas. Ratios are loose lower bounds; do not tighten them to the current render.
2. **Pixel baselines (focused, deterministic cases).** Cases with a `baseline` entry in `CASE_CHECKS` are compared with the committed PNGs in `tests/browser/visual/baselines/`. A pixel counts as different when any channel differs by more than 32/255, and the case fails when more than 0.2% of pixels differ (1% for the cases that include DOM text: `axes-title-grid`, `annotations`, `flamegraph`). The diff uses an in-script PNG codec (`scripts/png-image.ts`, unit tested in `tests/scripts/`), with no extra dependencies.

Artifacts land in `build/visual-tests/`: `<case>.png` (full page), `actual/<case>.png` (the exact crop compared with the baseline, ready to commit), and `diff/<case>.png` (expected dimmed with differing pixels in red, only on failure). Missing baselines fail the run.

#### Renderer runs

`bun run test:visual` runs the case list once per renderer configuration (`--renderer webgl2,shared,canvas2d,auto-no-webgl` selects a subset):

- `webgl2`: the default renderer; owns the committed baselines and the `build/visual-tests/` root (including `actual/`).
- `shared`: `?renderer=shared`, output in `build/visual-tests/shared/`. Renders through the shared WebGL2 context (one hidden WebGL context blitted into each chart canvas). See [Shared render context](./shared-render-context.md).
- `canvas2d`: `?renderer=canvas2d`, output in `build/visual-tests/canvas2d/`. It runs the same cases and blank-canvas guard. Never update baselines from this run (`--update-baselines` only writes the WebGL ones).
- `auto-no-webgl`: launches Chrome with `--disable-3d-apis` and constructs the chart with the default `"auto"` renderer, asserting it ended up on Canvas 2D. Blank-canvas guard only; the `context-restore` case is skipped because it needs a real WebGL context.

#### Cross-engine parity

When `webgl2` runs in the same invocation (the `visual-gl` shard runs `webgl2,shared`; the `visual-fallback` shard runs `webgl2,canvas2d,auto-no-webgl`), every case's plot-area crop (grid hidden) from `shared` and `canvas2d` is compared with the `webgl2` crop of the same case (`scripts/cross-engine.ts`, unit tests in `tests/scripts/crossEngine.test.ts`). Without a `webgl2` run in the invocation the other renderers are only checked against the committed baselines.

- `shared` must match `webgl2` to 8-bit rounding: a real GPU is bit-identical, SwiftShader differs by one count in a pixel or two.
- `canvas2d` is compared by kind (`CROSS_ENGINE_KINDS` in `scripts/visual-test.ts`; thresholds in `CROSS_ENGINE_THRESHOLDS`). Rectangles (`fill`: bars, histogram bins, translucent overlap) are compared per pixel (more than 32/255 on any channel counts, up to 0.8% of pixels). Everything with antialiased edges (`stroke`) is compared after a 3x3 box blur (up to 1%), because Canvas 2D antialiases lines where WebGL does not and pixel dilation does not forgive that. `dense-stroke` (the 100k-sample sine) allows 3%.
- Every kind also checks the coverage-weighted ink ratio (Canvas 2D over WebGL, within about 4% to 12% depending on the kind) and that the ink bounding boxes agree to one pixel (the engines break rasterization ties differently).
- A failure writes both crops to `build/visual-tests/cross-engine/<renderer>/`; every run writes `build/visual-tests/cross-engine.json`. `--cross-engine-report` prints the numbers without failing, for recalibration. The thresholds sit at roughly twice the worst case measured on a real GPU and on CI's SwiftShader; recalibrate them from CI logs, not a laptop alone.

Parity does not mean identical pixels: the contract is the feature set and the documented differences in [Browser support](../browser-support.md#rendering-engines). The `gaps` case (NaN gaps in a line and an area series) exists so every renderer has to break paths at missing samples; the first cross-engine run found Canvas 2D bridging area fills across gaps, which the engine contract suite now pins.

GPU, driver, and OS differences change anti-aliasing and text, so baselines must be generated in the CI environment (headless Chrome on `ubuntu-24.04` with SwiftShader/ANGLE software GL), not on a laptop. So the pixel comparison runs only on Linux by default; elsewhere it is skipped with a note and only the blank-canvas guard runs. `--compare-baselines` forces the comparison and `--skip-baselines` disables it.

To regenerate baselines after an intentional rendering change, or to add a case:

1. Push your branch and open or update the PR. The `Browser (visual-gl)` and `Browser (visual-fallback)` shards upload `visual-tests-visual-gl` and `visual-tests-visual-fallback` artifacts on every run (baselines come from the WebGL2 run, so `visual-tests-visual-gl`), pass or fail. (To refresh without a failing run, dispatch CI on the branch: `gh workflow run ci.yml --ref <branch>`.)
2. Download the artifact: `gh run download <run-id> -n visual-tests-visual-gl -D build/ci-visual-tests`.
3. Review `build/ci-visual-tests/actual/*.png` (and `diff/*.png` for failures) to confirm the change is intended.
4. Copy the reviewed images over the baselines and commit them: `cp build/ci-visual-tests/actual/*.png tests/browser/visual/baselines/`. Only copy the cases you meant to change.

On a Linux machine that matches CI (for example a container with the same Chrome), `bun run test:visual -- --update-baselines` writes `tests/browser/visual/baselines/*.png` directly. Running it on macOS or Windows prints a warning because the output will not match CI.

To add a baselined case, add a `baseline` entry (and a `minInkRatio`) to its `CASE_CHECKS` record. Only baseline cases that need no pointer input and use static data, and prefer `region: "plot"` (the WebGL canvas only) over `"chart"` when DOM text is not what is being tested.

`bun run bench:gate` is the performance regression gate: it runs the deterministic `perf-gate` scenario in 1 discarded plus 5 measured repetitions (10 if the first attempt fails), normalises timings by an in-page calibration workload, and compares medians with `benchmarks/thresholds.json`. Use `-- --report-only` to print the table without failing, and `-- --inject-slowdown-ms 2` to confirm the gate still catches a synthetic regression. Locally it is a sanity check: absolute numbers differ from the GitHub-hosted runners the baselines come from, so do not update `benchmarks/thresholds.json` from a laptop run. Methodology, hardware assumptions, and the update procedure are in [Release and benchmark notes](../release-and-benchmarks.md#performance-regression-gate).

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
bun run check          # typecheck, lint, unit tests + coverage floors, build, docs freshness and snippets, package checks, API snapshot, bundle budgets
bun run test:browser   # benchmark smoke, perf gates (WebGL2 and Canvas 2D), visual, interaction and axe a11y on both engines, stability on both engines, website (needs Chrome)
bun run ci             # both (cross-browser is a separate CI job: bun run test:cross-browser)
```

## Documentation changes

Verify public API names in docs against source, tests, or generated declarations. Complete examples include imports and cleanup.

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
bun run test:typescript-floor
```

`bun run test:api` compares the exported names and signatures in `dist/**/*.d.ts` (for every `package.json#exports` entry, comments and private members ignored) with the committed snapshot `api/public-api.md`. It needs a fresh `bun run build` first. When it fails, read the printed `-`/`+` lines: if the public API change is intentional, run `bun run build && bun run test:api -- --update` and commit the regenerated `api/public-api.md` in the same PR; if not, fix the source. The snapshot also lists types that public signatures reference but no entry point exports. Never hand-edit `api/public-api.md`.

`bun run test:typescript-floor` (after `bun run build`) packs the package with `bun pm pack`, installs the tarball plus TypeScript 5.0.4 and the latest 5.x into a temp consumer project, and typechecks a file importing every `package.json#exports` entry with `skipLibCheck: false` under `moduleResolution: bundler` and `node16`. It needs network access to install TypeScript, so it is a separate CI job rather than part of `bun run check`. Pass `--ts 5.0.4,5.4.5` to pick versions and `--keep` to keep the temp project. When the minimum TypeScript version changes, update `FLOOR` in `scripts/typescript-floor-test.ts` and [TypeScript support](../versioning-and-migration.md#typescript-support).

Use `bun run docs:bundle-size` to print the current bundle-size table and `bun run bundle:analyze` when a chunk grows unexpectedly.

## Release checklist

Release commands and branch policy: [Release and benchmark notes](../release-and-benchmarks.md). Checklist: [Release checklist](./release-checklist.md). Summary:

1. Create a `release/vX.Y.Z` branch from updated `main`.
2. Run `bun run release patch` (or `minor` / `major`): bumps the version, drafts the changelog, and regenerates docs.
3. Edit `changelogs/vX.Y.Z.md` and commit.
4. Open the release PR to `main` and squash-merge it.
