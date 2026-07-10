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
- Typecheck: `bun run typecheck` (`tsc --noEmit`).
- Build the npm package: `bun run build` (Vite library build plus declaration emit via `vite-plugin-dts`).
- Build JS only: `bun run build:js`.
- Build the docs/site: `bun run pages:build`; preview with `bun run pages:preview`.
- Dev server: `bun run dev` serves the Lit website (`website/`) with integrated docs and previews. Use `bun run legacy-preview:dev` only for browser fixture debugging under `tests/browser/`.
- Full CI locally: `bun run ci` (typecheck + unit tests + package build + generated-doc checks + docs snippet typecheck + package export smoke test + package contents dry-run + bundle-size check + headless benchmark smoke test + automated chart visual tests + automated interaction tests).
- Generated docs check only: `bun run test:generated-docs`.
- Documentation snippet typecheck only: `bun run test:docs-snippets`.
- Regenerate README/API docs: `bun run docs:readme` (builds `dist/`, regenerates `docs/api-reference.md`, and refreshes generated README docs sections).
- Benchmark smoke test only: `bun run bench:ci` (`ci-smoke` scenario in a headless Chrome/Chromium/Brave browser). Set `BLAZEPLOT_BENCH_CHROME=/path/to/browser` or `CHROME_PATH=/path/to/browser` if auto-detection fails.
- Public manual comparison benchmark: `bun run bench:compare` (headed by default, fully automated after launch, compares BlazePlot/uPlot/Chart.js, overwrites `benchmarks/latest.json` and `benchmarks/latest.md`; not part of CI).
- Run one benchmark scenario: `bun run bench -- --scenario <name>`.
- Append benchmark results to the current release changelog: `bun run release:benchmarks`.
- Append benchmark report markdown to docs or another path: `bun run bench:report`.
- Chart visual tests only: `bun run test:visual` (renders focused browser cases per chart/plugin feature and writes screenshots to `build/visual-tests/`).
- Browser interaction tests only: `bun run test:interaction` (automates hover, crosshair, wheel zoom, shift-drag pan, box zoom, reset, and selection through Chrome DevTools Protocol input events).
- Package export smoke test: `bun run test:exports`.
- Package contents dry-run: `bun run test:package` or `bun pm pack --dry-run`.
- Bundle-size budget check: `bun run test:bundle-size`; markdown summary: `bun run docs:bundle-size`; detailed analysis: `bun run bundle:analyze`.
- There is no lint or formatter script in `package.json`.

## Branch and Release Flow

- `development` is the integration branch for normal feature, fix, docs, and workflow work. Branch from an updated `development`.
- Implement each requested feature/fix on its own branch, for example `feature/<topic>`, `fix/<topic>`, or `docs/<topic>`. Keep commits and PRs focused.
- Open a focused feature PR from that branch back to `development` for normal feature/fix/docs work unless the maintainer explicitly asks for a direct local merge.
- Commit `AGENTS.md`/process-guide updates separately from product code, tests, generated docs, or release changes.
- Merge completed feature branches back to `development`; prefer `git merge --no-ff <feature-branch>` when asked to merge locally so feature boundaries remain visible.
- `main` is the protected release branch. Open release PRs from `development` to `main` only when the user explicitly asks for a release PR.
- Do not push tags manually for releases. Tags are outputs of `.github/workflows/release.yml`.
- GitHub Pages deploys on pushes to `main` and `development`. Stable site: `https://blazeplot.cervelli.dev/`; stable previews: `https://blazeplot.cervelli.dev/previews`; development site: `https://blazeplot.cervelli.dev/development/`; development previews: `https://blazeplot.cervelli.dev/development/previews`.
- Maintainers can request feature-branch browser previews with the manual `Cloudflare Pages Preview` workflow. See `docs/release-and-benchmarks.md` and `docs/internal/github-workflows.md` for alias rules and safety notes.
- To prepare a release PR:
  1. Start on updated `development`.
  2. Run `bun run version:patch` (or `version:minor` / `version:major`) to bump `package.json` and create `changelogs/vX.Y.Z.md`.
  3. Edit the changelog notes.
  4. Run `bun run release:benchmarks` so benchmark tables are included in the version markdown. The release workflow also runs this with `--if-missing` before publishing.
  5. Run `bun run docs:readme` so generated API docs and README sections are current.
  6. Run `bun run ci`, `bun run pages:build`, and `bun pm pack --dry-run`.
  7. Push `development`, open a PR to `main`, wait for the `validate` check, then merge when approved/authorized.
- Merging an unpublished `package.json` version to `main` runs the release workflow: CI, benchmark-result insertion if missing, package pack, npm publish with provenance, `vX.Y.Z` tag creation, and GitHub Release creation from `changelogs/vX.Y.Z.md` plus commits.
- If the `vX.Y.Z` tag already exists, the release workflow skips publishing for that version.

## Project Shape

- Public top-level API exports live in `src/index.ts`; charts are created with the `Chart` constructor.
- npm package output includes `dist/index.js` / `dist/index.d.ts` plus subpath entries for `core`, `interaction`, `render`, `linked`, `linked-core`, `data`, `export`, and built-in plugins under `plugins/*`. Keep `package.json#exports` and `vite.config.ts#build.lib.entry` in sync.
- Optional plugin subpaths currently include `legend`, `tooltip`, `interactions`, `annotations`, `selection`, `crosshair`, `navigator`, and `flamegraph`.
- `src/core/` is the data engine and should not depend on UI, DOM, or GPU code.
- `src/render/` owns the GPU abstraction, renderer orchestration, shader programs, WebGL2 resources, and native WebGL2 backend.
- `src/interaction/` owns `Camera2D`, `AxisController`, and viewport policy/intent types; interaction mutates the camera, not series data.
- `src/ui/Chart.ts` is the chart orchestrator wiring `SeriesStore`, `Renderer`, `WebGL2Backend`, `Camera2D`, `AxisController`, layout/overlays, and optional `ViewportPolicy.beforeRender`. Public typed helpers (`addLine`, `addArea`, `addScatter`, `addBar`, `addOhlc`, `addCandlestick`) delegate to `addSeries`.
- Built-in plugin implementation classes live in `src/ui/`; package plugin entry points live in `src/plugins/` and should stay optional imports.
- `website/` is the docs/previews app served by `bun run dev` and built by `bun run pages:build`. Shared website preview data helpers live in `website/src/`.
- `docs/` contains public docs plus maintainer runbooks under `docs/internal/`. `docs/README.md` is the docs map.
- `tests/browser/` contains the Vite-served benchmark, visual, and interaction fixture pages used by `bun run bench:ci`, `bun run test:visual`, and `bun run test:interaction`. `bun run legacy-preview:dev` serves this fixture root for debugging.

## Current Implementation Gotchas

- `WebGL2Backend` requires WebGL2. It implements buffer creation/update, program handles, instanced attributes, scissor clipping, and resource disposal for current line, min/max segment, scatter, bar, area, OHLC, candlestick, and flamegraph rendering needs.
- `WebGL2Backend.viewport()` uses WebGL scissor test to clip draws and refreshes the full drawing-buffer viewport after canvas resizes. `clear()` is unaffected and always clears the full canvas.
- `ChartLayout` owns the DOM layout. Outside axes reserve real grid gutters, while the WebGL canvas is sized to the plot area only.
- `chart.screenshot()` composites the plot WebGL canvas plus built-in DOM text overlays into one exported image; keep DOM overlay text under the chart root for inclusion.
- `AxisOverlay` attaches tick label elements either to the plot layer (`inside`) or to the axis gutter layer (`outside`).
- Axis `outside` positioning reserves fixed CSS-pixel gutters: 52px left for Y, 28px bottom for X. Defined by `LEFT_AXIS_GUTTER_CSS` / `BOTTOM_AXIS_GUTTER_CSS` in `ChartLayout.ts`.
- `MinMaxPyramid` updates incrementally for tail appends and falls back to full rebuild on explicit rebuild/clear. `SeriesStore` detects ring shifts at fixed capacity and avoids per-frame full pyramid rebuilds; dense min/max extraction then uses the optional `RangeMinMaxDataset.rangeMinMaxY()` capability. `RingBuffer` implements that capability with a physical segment tree, so wrapped streaming queries are logarithmic instead of full raw scans. Dense non-wrapped extraction uses `MinMaxPyramid.rangeMinMax()` over pyramid buckets.
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
- `tsconfig.build.json` scopes declaration generation to `src/`; `vite-plugin-dts` emits package declarations during `vite build`.

## Documentation Rules

- Use `docs/README.md` to decide where a topic belongs before adding or moving docs.
- Do not hand-edit generated sections in `README.md`, `docs/api-reference.md`, or `docs/benchmarks.md`; run `bun run docs:readme` instead.
- Verify documented APIs against source, tests, or generated declarations.
- Complete docs snippets should include imports and lifecycle cleanup for charts, timers, workers, object URLs, and plugin handles.
- For docs changes, run the smallest relevant checks from `docs/documentation-contributions.md`; run `bun run pages:build` when website routing/rendering changes.

## Tests

- Unit tests cover core data structures (including raw sample picking helpers), OHLC/server/static datasets, data export helpers, render helpers, `Camera2D`, and axis behavior (`tests/core`, `tests/data`, `tests/render`, `tests/interaction`).
- Website/docs tests cover generated documentation automation and markdown links (`tests/website`, `bun run test:generated-docs`, `bun run test:docs-snippets`).
- Browser visual tests (`bun run test:visual`) cover focused WebGL/DOM/plugin rendering cases and write screenshots plus summaries to `build/visual-tests/`.
- Browser interaction tests (`bun run test:interaction`) drive Chrome DevTools Protocol input events for hover, crosshair, wheel zoom, shift-drag pan, box zoom, reset, and selection.
- Full local validation is `bun run ci`; use targeted test scripts for focused changes when the full browser suite is unnecessary.
- Run `bun run test:exports` after `bun run build` when package entry points or Vite library entries change; run `bun run test:package` when package metadata or files change; run `bun run test:bundle-size` when bundle composition may change.
