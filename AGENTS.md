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
- Preview package contents: `bun pm pack --dry-run`.
- Dev server: `bun run dev`; `vite.config.ts` serves `preview/` and opens the browser automatically.
- There is no lint or formatter script in `package.json`.

## Project Shape

- Public API exports live in `src/index.ts`.
- npm package output is `dist/index.js` and `dist/index.d.ts`; package metadata points `exports`, `main`, `module`, and `types` at `dist/`.
- `preview/` is detached from package output and is the only app served by `bun run dev`.
- `preview/main.ts` streams data into `Chart` and currently reports `renderer: raw line strip`.
- `src/core/` is the data engine and should not depend on UI, DOM, or GPU code.
- `src/render/` owns the GPU abstraction and the WebGL2/regl implementation.
- `src/interaction/` owns `Camera2D`, input/tick helpers, and viewport policy types; interaction mutates the camera, not series data.
- `src/ui/Chart.ts` is the orchestrator wiring `SeriesStore`, `Renderer`, `ReglBackend`, `InputController`, `Camera2D`, and optional `ViewportPolicy`.

## Current Implementation Gotchas

- `ReglBackend` requires WebGL2. It implements buffer creation/update, program handles, cached draw commands, and resource disposal for current raw-line needs.
- `ReglBackend.viewport()` uses WebGL scissor test to clip draws to the plot area; it does **not** change the GL viewport. `clear()` is unaffected and always clears the full canvas.
- `Chart.render()` first clears the full canvas, then sets the scissor inset via `viewport()` before drawing grid + series.
- `AxisOverlay` positions a DOM overlay over the canvas using `getBoundingClientRect`; the parent must be a positioned containing block (the constructor sets `position: relative` if the parent is `static`).
- Axis `outside` positioning reserves fixed CSS-pixel margins: 52px left for Y, 28px bottom for X. Defined by `LEFT_MARGIN_CSS` / `BOTTOM_MARGIN_CSS` in `Chart.ts`.
- `MinMaxPyramid.build()` is a full bottom-up rebuild today; incremental pyramid updates are roadmap-only.
- `RingBuffer` silently wraps at capacity and exposes logical-order access after wrap.
- LOD queries use sorted logical X values via `RingBuffer.lowerBoundX` / `upperBoundX`; preserve that assumption when changing append/query code.
- `ViewportPolicy` transforms `PanIntent`/`ZoomIntent` and can update `Camera2D` before render. Keep behavior rules there, not in core/rendering.
- In the preview, synced-X behavior keeps live X follow active while wheel zoom/pan are Y-only.

## TypeScript Conventions

- Package source under `src/` uses ESM-style `.js` relative import specifiers so emitted JS and declarations line up for npm consumers.
- Use the `@/*` alias for `src/*` when it improves clarity; it is configured in both `tsconfig.json` and `vite.config.ts`.
- Prefer relative imports inside `src/` package code so declaration output does not leak the `@/*` alias. `preview/` can use `@/*`.
- `tsconfig.json` is strict and enables `noUncheckedIndexedAccess`, `noUnusedLocals`, and `noUnusedParameters`; unused placeholders are usually prefixed with `_`.
- `tsconfig.build.json` scopes declaration generation to `src/`; `vite-plugin-dts` emits package declarations during `vite build`.

## Tests

- Tests currently cover core data structures and `Camera2D` only (`tests/core`, `tests/interaction`).
- There is no DOM/WebGL test harness; rendering behavior is best checked through `bun run dev`, `bun run build`, and manual preview checks unless a test harness is added.
