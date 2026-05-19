# AGENTS.md

## Commands

- Use Bun; `bun.lock` is the lockfile and `bun test` is the test runner.
- Install deps with `bun install` if `node_modules/` is missing.
- Run all tests: `bun test`.
- Run one test file: `bun test tests/core/RingBuffer.test.ts`.
- Run one named test: `bun test tests/core/RingBuffer.test.ts -t "wraps around"`.
- Typecheck: `bun run typecheck` (`tsc --noEmit`).
- Build the npm package: `bun run build` (Vite/Rolldown library build + declaration emit via `vite-plugin-dts`).
- Build JS only: `bun run build:js`.
- Full CI locally: `bun run ci` (typecheck + tests + package build + package export smoke test + package contents dry-run + bundle-size check + headless benchmark smoke test + automated chart visual tests + automated interaction tests).
- Benchmark smoke test only: `bun run bench:ci` (`ci-smoke` scenario in a headless Chrome/Chromium/Brave browser). Set `BLAZEPLOT_BENCH_CHROME=/path/to/browser` if auto-detection fails.
- Chart visual tests only: `bun run test:visual` (renders one focused browser case per chart/plugin feature, asserts render/DOM/screenshot output, and writes screenshots to `build/visual-tests/`).
- Browser interaction tests only: `bun run test:interaction` (automates hover, crosshair, wheel zoom, shift-drag pan, box zoom, reset, and selection through Chrome DevTools Protocol input events).
- Append benchmark results to the current release changelog: `bun run release:benchmarks`.
- Preview package contents: `bun pm pack --dry-run`.
- Dev server: `bun run dev`; `vite.config.ts` serves `preview/` and opens the browser automatically.
- There is no lint or formatter script in `package.json`.

## Branch and Release Flow

- `main` is the protected release branch. It requires PRs, the `validate` status check, up-to-date branches, conversation resolution, linear history, and blocks force-push/deletion. It does **not** require approving reviews so the agent can merge its own tested release PRs when asked.
- `development` is the integration branch for normal work. Open feature/fix PRs into `development`; open release PRs from `development` into `main`.
- Implement each requested feature/fix on its own branch from updated `development` (for example `feature/<topic>` or `docs/<topic>`), make focused commits there, then merge it back to `development`. Do not stack unrelated changes in one feature branch.
- Prefer `git merge --no-ff <feature-branch>` when merging completed feature branches back to `development` so feature boundaries remain visible in history.
- Do not open PRs to `main` until the user explicitly asks for a release PR. Normal completed work should stop after merging to `development` and pushing it.
- GitHub Pages deploys on pushes to `main` and `development`. The stable `main` preview is served at `https://federicocervelli.github.io/blazeplot/`; the in-progress `development` preview is served at `https://federicocervelli.github.io/blazeplot/development/`; React previews live under `/react/` for both branches; `previews.html` links all previews.
- Releases are merge-to-main based. Do not use tag-push/manual release scripts.
- To prepare a release PR:
  1. Start on updated `development`.
  2. Run `bun run version:patch` (or `version:minor` / `version:major`) to bump `package.json` and create `changelogs/vX.Y.Z.md`.
  3. Edit the changelog notes.
  4. Run `bun run release:benchmarks` so benchmark tables are included in the version markdown. The release workflow also runs this with `--if-missing` before publishing.
  5. Run `bun run docs:readme` so the README changelog link points at the new version.
  6. Run `bun run ci`, and ideally `bun run pages:build` and `bun pm pack --dry-run`.
  7. Push `development`, open a PR to `main`, wait for `validate`, then merge.
- Merging an unpublished `package.json` version to `main` runs the release workflow: CI, benchmark-result insertion if missing, package pack, npm publish, `vX.Y.Z` tag creation, and GitHub Release creation from `changelogs/vX.Y.Z.md` plus commits.
- If the `vX.Y.Z` tag already exists, the release workflow skips publishing for that version.

## Project Shape

- Public API exports live in `src/index.ts`.
- npm package output includes the core `dist/index.js` / `dist/index.d.ts` plus separate subpath chunks/declarations for `react`, `linked`, `export`, and built-in plugins; package metadata points `exports`, `main`, `module`, and `types` at `dist/`.
- `preview/` is detached from package output and is the only app served by `bun run dev`.
- `preview/main.ts` streams data into `Chart` and reports `renderer: ${chartStats.renderMode}`.
- `src/core/` is the data engine and should not depend on UI, DOM, or GPU code.
- `src/render/` owns the GPU abstraction and the WebGL2/regl implementation.
- `src/interaction/` owns `Camera2D`, tick helpers, and viewport policy/intent types; interaction mutates the camera, not series data.
- `src/ui/Chart.ts` is the orchestrator wiring `SeriesStore`, `Renderer`, `ReglBackend`, `Camera2D`, and optional `ViewportPolicy.beforeRender`; public typed helpers (`addLine`, `addArea`, `addScatter`, `addBar`, `addOhlc`, `addCandlestick`) delegate to `addSeries`. Pointer/wheel interactions live in the optional interactions plugin.

## Current Implementation Gotchas

- `ReglBackend` requires WebGL2. It implements buffer creation/update, program handles, cached draw commands, instanced attributes, and resource disposal for current line, min/max segment, scatter, bar, area, OHLC, and candlestick rendering needs.
- `ReglBackend.viewport()` uses WebGL scissor test to clip draws; it does **not** change the GL viewport. `clear()` is unaffected and always clears the full canvas.
- `ChartLayout` owns the DOM layout. Outside axes reserve real grid gutters, while the WebGL canvas is sized to the plot area only.
- `chart.screenshot()` composites the plot WebGL canvas plus built-in DOM text overlays into one exported image; keep DOM overlay text under the chart root for inclusion.
- `AxisOverlay` attaches tick label elements either to the plot layer (`inside`) or to the axis gutter layer (`outside`).
- Axis `outside` positioning reserves fixed CSS-pixel gutters: 52px left for Y, 28px bottom for X. Defined by `LEFT_AXIS_GUTTER_CSS` / `BOTTOM_AXIS_GUTTER_CSS` in `ChartLayout.ts`.
- `MinMaxPyramid` updates incrementally for tail appends and falls back to full rebuild on explicit rebuild/clear. `SeriesStore` detects ring shifts at fixed capacity and avoids per-frame full pyramid rebuilds; dense min/max extraction then uses the optional `RangeMinMaxDataset.rangeMinMaxY()` capability. `RingBuffer` implements that capability with a physical segment tree, so wrapped streaming queries are logarithmic instead of full raw scans. Dense non-wrapped extraction uses `MinMaxPyramid.rangeMinMax()` over pyramid buckets.
- Area series skip LOD even when `downsample` is omitted. Scatter series use exact 2D-culled chunks with `downsample: "none"`; default scatter uses a 2D viewport-aware point sampler with min/max interval pruning and only decimates after exact visible extraction exceeds the point budget. Bar series use min/max LOD by default (unless `downsample: "none"`). Dense sampled bars render as expanded triangle buckets spanning the full screen-space sample bucket and including the configured baseline in the min/max range; do not render dense sampled bars as centered raw-position quads or gaps will appear. Scatter/bar prefer instanced quads when regl/browser instancing is available for raw sparse draws, with non-instanced fallbacks (`gl.POINTS` sprites for scatter, expanded triangle quads for bars); area renders as a triangle strip plus line overlay.
- `RingBuffer` wraps at capacity by default and exposes logical-order access after wrap; callers can opt into `"drop-new"` or `"error"` overflow semantics when constructing a buffer or via `SeriesConfig.overflow`.
- LOD queries use sorted logical X values via `RingBuffer.lowerBoundX` / `upperBoundX`; preserve that assumption when changing append/query code.
- `Chart.render()` calls `SeriesStore.rebuildPyramid()` before drawing visible series and re-extracts visible samples/segments from the current `Camera2D` viewport every frame.
- `ViewportPolicy` transforms `PanIntent`/`ZoomIntent` and can update `Camera2D` before render. Keep behavior rules there, not in core/rendering.
- Optional built-ins like interactions, legend, tooltip, annotations, selection, crosshair, and navigator are Chart plugins exported from subpaths (`blazeplot/plugins/*`). `Chart` owns only the lightweight plugin contract and public state/pick/camera APIs; avoid importing built-in plugins into `Chart.ts` or the top-level entry.
- Hover state refreshes every render while the pointer is inside the plot, so live-follow charts update tooltips even when the cursor is still. `chart.pick()` returns actual raw sample coordinates plus plot/client coordinates for marker overlays.
- In the preview, synced-X behavior keeps live X follow active while wheel zoom/pan are Y-only.

## TypeScript Conventions

- Package source under `src/` uses ESM-style `.js` relative import specifiers so emitted JS and declarations line up for npm consumers.
- Optional plugin subpath entries live under `src/plugins/` and are configured as separate Vite library entries plus `package.json` subpath exports to keep chart-only imports lean.
- Use the `@/*` alias for `src/*` when it improves clarity; it is configured in both `tsconfig.json` and `vite.config.ts`.
- Prefer relative imports inside `src/` package code so declaration output does not leak the `@/*` alias. `preview/` can use `@/*`.
- `tsconfig.json` is strict and enables `noUncheckedIndexedAccess`, `noUnusedLocals`, and `noUnusedParameters`; unused placeholders are usually prefixed with `_`.
- `tsconfig.build.json` scopes declaration generation to `src/`; `vite-plugin-dts` emits package declarations during `vite build`.

## Tests

- Unit tests cover core data structures (including raw sample picking helpers), OHLC datasets, series extraction, `Camera2D`, and axis behavior (`tests/core`, `tests/interaction`).
- Browser visual tests (`bun run test:visual`) cover focused WebGL/DOM/plugin rendering cases and write screenshots to `build/visual-tests/`.
- Browser interaction tests (`bun run test:interaction`) drive Chrome DevTools Protocol input events for hover, crosshair, wheel zoom, shift-drag pan, box zoom, reset, and selection.
- Full local validation is `bun run ci`; use targeted test scripts for focused changes when the full browser suite is unnecessary. Run `bun run test:exports` after `bun run build` when package entry points or Vite library entries change; run `bun run test:package` when package metadata or files change.
