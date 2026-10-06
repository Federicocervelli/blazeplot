# Documentation contributions

BlazePlot docs should help a developer decide what to build, copy a correct starting point, and understand the tradeoffs that matter for performance. Avoid broad claims unless the page also says when the advice stops applying.

## Contribution workflow

1. Start from updated `main` and create a focused `docs/<topic>` branch.
2. Identify the user path before editing: first chart, streaming data, plugin usage, React, linked dashboards, export, or maintainer release work.
3. Verify the API from source, tests, or generated declarations before documenting it.
4. Prefer one small, complete example over several partial snippets.
5. Run the smallest relevant checks before opening or merging the change.

For generated reference updates, run `bun run docs:readme`. That command builds the package, regenerates `docs/api-reference.md`, and updates the generated README section. Do not hand-edit `docs/api-reference.md` or the generated README section.

Related maintainer runbook: [Local development](./internal/local-development.md). Page map: [Documentation map](./README.md).

## What useful docs look like

- Say who the page is for in the first paragraph.
- Put the common path first, then list edge cases and tradeoffs.
- Show required imports and cleanup code when a snippet creates a chart, timer, worker, plugin handle, or object URL.
- Link to the next page a reader needs instead of repeating large sections.
- Name the failure mode when a rule exists, for example unsorted X values breaking binary search, LOD, picking, and visible exports.

## What to avoid

- Marketing adjectives without evidence.
- Snippets that omit the import, chart lifecycle, or dataset type needed to run them.
- Repeating the same feature list across pages.
- Documenting internal implementation details as public API.
- Adding a new page when an existing guide can be improved with a short section.

## Snippet typechecking

`bun run test:docs-snippets` typechecks every `ts`, `typescript`, and `tsx` code fence in `README.md` and `docs/` (except `docs/internal/`). It runs inside `bun run check`, after the build, and checks snippets against the published declarations in `dist/` and the subpaths in `package.json#exports`, so run `bun run build` first. Snippets that use a removed or unexported import path fail.

The checker never skips a snippet silently. A snippet either typechecks or fails the run. The output reports how many snippets were checked and how many were explicitly skipped.

A snippet may rely on this ambient context without declaring it. The names are conventional placeholders, declared as the `prelude` constant in `scripts/typecheck-doc-snippets.ts`:

| Name | Type |
|---|---|
| `element` | `HTMLElement` |
| `container` | `HTMLElement` |
| `canvas` | `HTMLCanvasElement` |
| `chart` | `Chart` |
| `series` | `SeriesStore` |
| `dataset` | `UniformRingBuffer` |

A snippet that declares its own binding with one of these names shadows the ambient one. Anything else a snippet uses (sample arrays, `socket`, helper functions, other series) must be declared in the snippet, with a realistic literal or a short stub, and every import must be written out. To add a name to the prelude, edit `prelude` and this table together, and only for context that many snippets share.

For the rare snippet that cannot typecheck, put a skip marker with a reason directly before the fence:

````md
<!-- snippet: skip maintainer-only fragment that imports an internal module -->
```ts
// ...
```
````

The reason is required and is printed on every run. Use it for internal maintainer code or output samples, not to avoid fixing a snippet that uses the public API. A marker that is not directly followed by a code fence fails the run.

## Verification checklist

Use this checklist in PR descriptions for docs changes.

| Check | When to run |
|---|---|
| Read changed docs in `bun run dev` | Any website-visible docs change |
| `bun run typecheck` | Code snippets reference TypeScript APIs or docs nav changes |
| `bun run build && bun run test:docs-snippets` | Any ts/tsx code fence added or changed (see [Snippet typechecking](#snippet-typechecking)) |
| `bun run build` | Package exports or website imports changed |
| `bun run docs:readme` | Generated API reference, declarations, or README docs section needs refresh |
| `bun run pages:build` | Website docs routing, markdown rendering, or nav changed |

## Page ownership

| Page | Purpose |
|---|---|
| `docs/README.md` | Documentation map, reader paths, and organization rules |
| `docs/overview.md` | First chart, package fit, and main tradeoffs |
| `docs/examples.md` | Copy-paste usage patterns for app developers |
| `docs/framework-integration.md` | React, Vue, Svelte, SSR framework lifecycle patterns and the no-WebGL2 fallback |
| `docs/data-semantics.md` | Dataset ordering, gaps, bounds, and export behavior |
| `docs/performance-recipes.md` | Data-shape choices and rendering budget guidance |
| `docs/built-in-plugins.md` | Optional plugin usage and plugin handles |
| `docs/plugin-authoring.md` | Public plugin contract for custom UI/behavior |
| `docs/theming-and-layout.md` | Theme tokens, axes, gutters, and responsive layout |
| `docs/troubleshooting.md` | Common blank-chart, lifecycle, performance, axis, React, and screenshot failures |
| `docs/stability.md` | Stable, experimental, and internal tiers per export; update when exports or subpaths change |
| `docs/migrating-to-1.0.md` | 0.x to 1.0 upgrade guide; update it for every breaking change or new 1.0 feature, checked against the 1.0 changelogs (`changelogs/v1.0.0*.md`) and `api/public-api.md` |
| `docs/error-handling.md` | Thrown errors, console output, and invalid-input behavior; update when source throws or warns differently |
| `docs/accessibility.md` | ARIA, keyboard, and plugin accessibility behavior, grounded in `src/ui/` and `src/plugins/a11y/` |
| `docs/api-reference.md` | Generated import paths and public symbols |
