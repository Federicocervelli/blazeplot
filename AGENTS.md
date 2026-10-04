# AGENTS.md

## Sources of Truth / How to Refresh This File

Keep this file as a quick operational guide, not the canonical source. When updating it, verify against these files first:

- Commands, package manager version, npm exports, package files, and dependency constraints: `package.json` and `bun.lock`.
- Library build entries and declaration output: `vite.config.ts`, `tsconfig.build.json`, and `src/*` barrel exports.
- Website build and routing: `vite.pages.config.ts`, `website/`, and `docs/README.md`.
- GitHub CI, Pages, Cloudflare preview, and release automation: `.github/workflows/*.yml` plus `docs/internal/github-workflows.md`.
- Branch/release process and benchmark policy: `docs/release-and-benchmarks.md` and `docs/internal/release-checklist.md`.
- Local validation commands: `docs/internal/local-development.md` and current `package.json#scripts`.
- Documentation ownership and generated-doc rules: `docs/README.md` and `docs/documentation-contributions.md`.
- Current implementation behavior: source under `src/` and focused tests under `tests/`; code and tests beat stale prose.

## Commands

- Use Bun; `package.json#packageManager` pins the expected Bun version and `bun.lock` is the lockfile.
- Install deps with `bun install` locally if `node_modules/` is missing; CI uses `bun install --frozen-lockfile`.
- Run all unit tests: `bun test`.
- Run one test file: `bun test tests/core/RingBuffer.test.ts`.
- Run one named test: `bun test tests/core/RingBuffer.test.ts -t "wraps around"`.
- Unit tests with coverage floors: `bun run test:coverage` (`scripts/coverage-check.ts`; part of `check`). Floors are ratchets just under baseline: raise them as coverage improves, never lower them.
- Typecheck: `bun run typecheck` (`tsc --noEmit`).
- Build the npm package: `bun run build` (Vite library build plus declaration emit via `tsc -p tsconfig.build.json`).
- Build JS only: `bun run build:js`.
- Build the docs/site: `bun run pages:build`; preview with `bun run pages:preview`.
- Dev server: `bun run dev` serves the Lit website (`website/`) with integrated docs and previews. Use `bun run fixtures:dev` only for browser fixture debugging under `tests/browser/`.
- Full CI locally: `bun run ci`, which runs the same two groups as the CI jobs: `bun run check` (typecheck, unit tests, build, generated-doc and snippet checks, export smoke test, package dry-run, public API snapshot, bundle budgets) and `bun run test:browser` (benchmark smoke, visual, interaction, website tests in headless Chrome). Add new checks to those scripts, not to the workflow.
- Generated docs check only: `bun run test:generated-docs`.
- Documentation snippet typecheck only: `bun run test:docs-snippets`.
- Regenerate README/API docs: `bun run docs:readme` (builds `dist/`, regenerates `docs/api-reference.md`, and refreshes generated README docs sections).
- Benchmark smoke test only: `bun run bench:ci` (`ci-smoke` scenario in a headless Chrome/Chromium/Brave browser). Set `BLAZEPLOT_BENCH_CHROME=/path/to/browser` or `CHROME_PATH=/path/to/browser` if auto-detection fails.
- Public manual comparison benchmark: `bun run bench:compare` (headed by default, fully automated after launch, compares BlazePlot/uPlot/Chart.js, overwrites `benchmarks/latest.json` and `benchmarks/latest.md`; not part of CI).
- Run one benchmark scenario: `bun run bench -- --scenario <name>`.
- Append benchmark report markdown to docs or another path: `bun run bench:report`.
- Chart visual tests only: `bun run test:visual` (renders focused browser cases per chart/plugin feature, fails on blank canvases, compares focused cases with the committed pixel baselines in `tests/browser/visual/baselines/`, and writes screenshots/diffs to `build/visual-tests/`). Pixel baselines must come from the CI environment (ubuntu, SwiftShader), not a local GPU: download the `visual-tests` CI artifact (`gh run download <run-id> -n visual-tests`) and copy `actual/*.png` into the baselines dir, or run `bun run test:visual -- --update-baselines` on a CI-like Linux box. The pixel comparison is skipped on non-Linux platforms (`--compare-baselines` forces it, `--skip-baselines` disables it). Details: `docs/internal/local-development.md`.
- Browser interaction tests only: `bun run test:interaction` (automates hover, crosshair, wheel zoom, shift-drag pan, box zoom, reset, and selection through Chrome DevTools Protocol input events).
- Package export smoke test: `bun run test:exports`.
- Package contents dry-run: `bun run test:package` or `bun pm pack --dry-run`.
- Public API snapshot check: `bun run build && bun run test:api` compares `dist/**/*.d.ts` exports against `api/public-api.md`; after an intentional API change run `bun run build && bun run test:api -- --update` and commit the snapshot. Never hand-edit it.
- Bundle-size budget check: `bun run test:bundle-size`; markdown summary: `bun run docs:bundle-size`; detailed analysis: `bun run bundle:analyze`.
- Lint: `bun run lint` (Oxlint over `src`, `scripts`, `tests`, `website`; config in `.oxlintrc.json`, correctness category as errors). It runs as part of `bun run check`.
- There is no formatter script in `package.json`.

## Branch and Release Flow

- `main` is the default branch and the stable line. It is protected: changes land through PRs that pass the `validate` check. Branch from an updated `main`.
- `v1` is a temporary long-lived integration branch for the 1.0 release candidates (`1.0.0-rc.N`), deleted after 1.0 ships. For 1.0 work, branch from an updated `v1` and open the PR with base `v1`. Merge `main` into `v1` via a `sync/main-into-v1-*` PR (merge commit, not squash) at least weekly, after every stable release, and before each rc; keep `v1`'s rc version on `package.json` conflicts. At 1.0, `v1` merges into `main` with a merge commit. See `docs/release-and-benchmarks.md`.
- Release candidates: on a branch from `v1`, run `bun run release rc` (or `bun run release 1.0.0-rc.1` for the first; `--dry-run` previews), PR to `v1`. Pushes to `v1` publish `-rc.N` versions to npm `rc` with a GitHub pre-release and never deploy Pages; `main` never publishes prereleases and `v1` never publishes stable versions.
- Implement each requested feature/fix on its own branch, for example `feature/<topic>`, `fix/<topic>`, or `docs/<topic>`. Keep commits and PRs focused.
- Open a focused PR from that branch to `main`. PRs are squash-merged and the branch is deleted on merge.
- Commit `AGENTS.md`/process-guide updates separately from product code, tests, generated docs, or release changes.
- Merging to `main` (or `v1`) does not publish unless the PR bumps `package.json#version`. Open release PRs only when the user explicitly asks for one.
- Do not push tags manually for releases. Tags are outputs of `.github/workflows/release.yml`.
- GitHub Pages deploys once per push to `main`, from the release workflow (after publishing when it is a release). Stable site (latest release tag): `https://blazeplot.cervelli.dev/`; stable previews: `https://blazeplot.cervelli.dev/previews`; unreleased `main` site: `https://blazeplot.cervelli.dev/next/`; unreleased previews: `https://blazeplot.cervelli.dev/next/previews`.
- Maintainers can request feature-branch browser previews with the manual `Cloudflare Pages Preview` workflow. See `docs/release-and-benchmarks.md` and `docs/internal/github-workflows.md` for alias rules and safety notes.
- To prepare a release PR:
  1. From updated `main`, create `release/vX.Y.Z`.
  2. Run `bun run release patch` (or `minor` / `major`). It bumps `package.json`, drafts `changelogs/vX.Y.Z.md` from the commits since the last tag, and regenerates the docs.
  3. Edit the changelog notes and commit.
  4. Push the branch, open a PR to `main`, wait for the `validate` check, then squash-merge when approved/authorized. Benchmark tables are appended by the release workflow.
- Every push to `main` runs the release workflow. If the `package.json` version has no tag yet, it runs reusable CI, inserts benchmark results if missing, publishes to npm with provenance (trusted publishing), and creates the `vX.Y.Z` tag and GitHub Release from `changelogs/vX.Y.Z.md` plus commits. Either way it then deploys Pages once. Ordinary merges do not rerun CI on `main`; the pull request already passed it on an up-to-date branch.
- If the `vX.Y.Z` tag already exists, the release workflow skips publishing for that version.

## Project Shape

- Public top-level API exports live in `src/index.ts`; charts are created with the `Chart` constructor.
- npm package output includes `dist/index.js` / `dist/index.d.ts` plus subpath entries for `linked`, `data`, `export`, and built-in plugins under `plugins/*`. Do not add subpaths that re-export root symbols. Keep `package.json#exports`, `vite.config.ts#build.lib.entry`, and `scripts/package-export-smoke.ts` in sync. `tsconfig.build.json` uses `stripInternal`: mark renderer/internal members `/** @internal */` to keep them out of published typings.
- Optional plugin subpaths currently include `legend`, `tooltip`, `interactions`, `annotations`, `selection`, `crosshair`, `navigator`, and `flamegraph`.
- `src/core/` is the data engine and should not depend on UI, DOM, or GPU code.
- `src/render/` owns the GPU abstraction, renderer orchestration, shader programs, WebGL2 resources, and native WebGL2 backend.
- `src/interaction/` owns `Camera2D`, `AxisController`, and viewport policy/intent types; interaction mutates the camera, not series data.
- `src/ui/Chart.ts` is the chart orchestrator wiring `SeriesStore`, `Renderer`, `WebGL2Backend`, `Camera2D`, `AxisController`, layout/overlays, and `ViewportPolicy` (applied in `pan`/`zoom` and before render). Public typed helpers (`addLine`, `addArea`, `addScatter`, `addBar`, `addOhlc`, `addCandlestick`, `addHistogram`) delegate to `addSeries`, which resolves `SeriesStyleOptions` (CSS or RGBA colors) into a full `SeriesStyle`. Chart events go through one typed `ChartEventMap`.
- Built-in plugin implementation classes live in `src/ui/`; package plugin entry points live in `src/plugins/` and should stay optional imports.
- `website/` is the docs/previews app served by `bun run dev` and built by `bun run pages:build`. Shared website preview data helpers live in `website/src/`.
- `docs/` contains public docs plus maintainer runbooks under `docs/internal/`. `docs/README.md` is the docs map.
- `tests/browser/` contains the Vite-served benchmark, visual, and interaction fixture pages used by `bun run bench:ci`, `bun run test:visual`, and `bun run test:interaction`. `bun run fixtures:dev` serves this fixture root for debugging.

## Current Implementation Gotchas

- `WebGL2Backend` requires WebGL2. It implements buffer creation/update, program handles, instanced attributes, scissor clipping, and resource disposal. Lines wider than one device pixel render as instanced screen-space quads (`thick-line.vert`); dense min/max line buckets are padded to at least `lineWidth` tall.
- `WebGL2Backend.viewport()` uses WebGL scissor test to clip draws and refreshes the full drawing-buffer viewport after canvas resizes. `clear()` is unaffected and always clears the full canvas.
- `ChartLayout` owns the DOM layout. Outside axes reserve real grid gutters, while the WebGL canvas is sized to the plot area only.
- `chart.screenshot()` composites the plot WebGL canvas plus built-in DOM text overlays into one exported image; keep DOM overlay text under the chart root for inclusion.
- `AxisOverlay` attaches tick label elements either to the plot layer (`inside`) or to the axis gutter layer (`outside`).
- Axis `outside` positioning reserves fixed CSS-pixel gutters: 52px left for Y, 28px bottom for X. Defined by `LEFT_AXIS_GUTTER_CSS` / `BOTTOM_AXIS_GUTTER_CSS` in `ChartLayout.ts`.
- Built-in datasets (`RingBuffer`, `UniformRingBuffer`, `StaticDataset`) answer `rangeMinMaxY()` through the shared block segment tree in `src/core/MinMaxTree.ts` (`StaticDataset` builds it lazily), so dense min/max extraction is logarithmic. `SeriesStore` only allocates the internal `MinMaxPyramid` for downsampled custom datasets without `rangeMinMaxY`; it updates incrementally for tail appends and switches to raw scans when a custom ring shifts at fixed capacity.
- `UniformRingBuffer` is the fixed-rate/evenly-spaced streaming dataset path. Preserve its implicit X-spacing assumptions and public shorthand behavior when changing live-data code.
- Area series skip LOD even when `downsample` is omitted. `downsample: "server"` is for server-pre-sampled min/max datasets and renders supplied buckets directly. Scatter series use exact 2D-culled chunks with `downsample: "none"`; default scatter uses a 2D viewport-aware point sampler with min/max interval pruning and only decimates after exact visible extraction exceeds the point budget. Bar series use min/max LOD by default (unless `downsample: "none"`). Dense sampled bars render as expanded triangle buckets spanning the full screen-space sample bucket and including the configured baseline in the min/max range; do not render dense sampled bars as centered raw-position quads or gaps will appear. Scatter/bar prefer instanced quads when browser instancing is available for raw sparse draws, with non-instanced fallbacks (`gl.POINTS` sprites for scatter, expanded triangle quads for bars); area renders as a triangle strip plus line overlay.
- `RingBuffer` wraps at capacity by default and exposes logical-order access after wrap; callers can opt into `"drop-new"` or `"error"` overflow semantics when constructing a buffer or via `SeriesConfig.overflow`.
- LOD queries use sorted logical X values via `RingBuffer.lowerBoundX` / `upperBoundX`; preserve that assumption when changing append/query code.
- `Chart.render()` calls `SeriesStore.rebuildPyramid()` before drawing visible series and re-extracts visible samples/segments from the current `Camera2D` viewport every frame.
- `ViewportPolicy` transforms `PanIntent`/`ZoomIntent` and can update `Camera2D` before render. Keep behavior rules there, not in core/rendering.
- Optional built-ins like interactions, legend, tooltip, annotations, selection, crosshair, navigator, and flamegraph are Chart plugins exported from subpaths (`blazeplot/plugins/*`). `Chart` owns only the lightweight plugin contract and public state/pick/camera APIs; avoid importing built-in plugins into `Chart.ts` or the top-level entry.
- Hover state refreshes every render while the pointer is inside the plot, so live-follow charts update tooltips even when the cursor is still. `chart.pick()` returns actual raw sample coordinates plus plot/client coordinates for marker overlays.
- In the website preview, synced-X behavior keeps live X follow active while wheel zoom/pan are Y-only.

## TypeScript Conventions

- Package source under `src/` uses ESM-style `.js` relative import specifiers so emitted JS and declarations line up for npm consumers.
- Optional plugin subpath entries live under `src/plugins/` and are configured as separate Vite library entries plus `package.json` subpath exports to keep chart-only imports lean.
- Use the `@/*` alias for `src/*` when it improves clarity; it is configured in both `tsconfig.json` and Vite configs.
- Prefer relative imports inside `src/` package code so declaration output does not leak the `@/*` alias. Browser fixtures under `tests/browser/` can use `@/*`.
- `tsconfig.json` is strict and enables `noUncheckedIndexedAccess`, `noUnusedLocals`, and `noUnusedParameters`; unused placeholders are usually prefixed with `_`.
- `tsconfig.build.json` scopes declaration generation to `src/`; `tsc -p tsconfig.build.json` emits package declarations into `dist/` after the Vite build.

## Documentation Rules

- Use `docs/README.md` to decide where a topic belongs before adding or moving docs.
- Do not hand-edit generated sections in `README.md`, `docs/api-reference.md`, or `docs/benchmarks.md`; run `bun run docs:readme` instead.
- Verify documented APIs against source, tests, or generated declarations.
- Complete docs snippets should include imports and lifecycle cleanup for charts, timers, workers, object URLs, and plugin handles.
- For docs changes, run the smallest relevant checks from `docs/documentation-contributions.md`; run `bun run pages:build` when website routing/rendering changes.

## Tests

- Unit tests cover core data structures (including raw sample picking helpers), OHLC/server/static datasets, data export helpers, render helpers, `Camera2D`, and axis behavior (`tests/core`, `tests/data`, `tests/render`, `tests/interaction`).
- Website/docs tests cover generated documentation automation and markdown links (`tests/website`, `bun run test:generated-docs`, `bun run test:docs-snippets`).
- Browser visual tests (`bun run test:visual`) cover focused WebGL/DOM/plugin rendering cases. Per-case checks live in `CASE_CHECKS` in `scripts/visual-test.ts` (`minInkRatio` blank-canvas floor for every case, optional `baseline` for deterministic cases); the PNG codec/diff is `scripts/png-image.ts` with unit tests in `tests/scripts/`. Screenshots, `actual/` baseline candidates, `diff/` images, and `summary.json` go to `build/visual-tests/`; CI always uploads that folder as the `visual-tests` artifact.
- Browser interaction tests (`bun run test:interaction`) drive Chrome DevTools Protocol input events for hover, crosshair, wheel zoom, shift-drag pan, box zoom, reset, and selection.
- Full local validation is `bun run ci`; use targeted test scripts for focused changes when the full browser suite is unnecessary.
- Run `bun run test:exports` after `bun run build` when package entry points or Vite library entries change; run `bun run test:package` when package metadata or files change; run `bun run test:api` after `bun run build` when public types change; run `bun run test:bundle-size` when bundle composition may change.
