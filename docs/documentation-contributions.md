# Documentation contributions

BlazePlot docs should help a developer decide what to build, copy a correct starting point, and understand the tradeoffs that matter for performance. Avoid broad claims unless the page also says when the advice stops applying.

## Contribution workflow

1. Start from updated `development` and create a focused `docs/<topic>` branch.
2. Identify the user path before editing: first chart, streaming data, plugin usage, React, linked dashboards, export, or maintainer release work.
3. Verify the API from source, tests, or generated declarations before documenting it.
4. Prefer one small, complete example over several partial snippets.
5. Run the smallest relevant checks before opening or merging the change.

For generated reference updates, run `bun run docs:readme` after `bun run build`. Do not hand-edit `docs/api-reference.md` or the generated README section.

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

## Verification checklist

Use this checklist in PR descriptions for docs changes.

| Check | When to run |
|---|---|
| Read changed docs in `bun run dev` | Any website-visible docs change |
| `bun run typecheck` | Code snippets reference TypeScript APIs or docs nav changes |
| `bun run build` | Package exports, generated declarations, or website imports changed |
| `bun run docs:readme` | Generated API reference or README docs section needs refresh |
| `bun run pages:build` | Website docs routing, markdown rendering, or nav changed |

## Page ownership

| Page | Purpose |
|---|---|
| `docs/overview.md` | First chart, package fit, and main tradeoffs |
| `docs/examples.md` | Copy-paste usage patterns for app developers |
| `docs/data-semantics.md` | Dataset ordering, gaps, bounds, and export behavior |
| `docs/performance-recipes.md` | Data-shape choices and rendering budget guidance |
| `docs/built-in-plugins.md` | Optional plugin usage and plugin handles |
| `docs/plugin-authoring.md` | Public plugin contract for custom UI/behavior |
| `docs/theming-and-layout.md` | Theme tokens, axes, gutters, and responsive layout |
| `docs/api-reference.md` | Generated import paths and public symbols |

