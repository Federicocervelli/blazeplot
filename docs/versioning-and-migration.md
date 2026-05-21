# Versioning and migration

BlazePlot follows npm semver. Use this page to decide whether a change is patch/minor/major and to plan upgrades between versions.

## Semver policy

| Release type | Allowed changes | Examples |
|---|---|---|
| Patch | Bug fixes, docs, compatible performance improvements, test/release fixes | Fix picking around gaps, reduce allocations, clarify examples, update benchmark docs. |
| Minor | Additive public APIs or behavior that should not break existing apps | New chart options, new plugins, new subpath exports, extra helper functions. |
| Major | Intentional breaking changes | Removed exports, renamed options without aliases, changed dataset contracts, incompatible plugin lifecycle changes. |

## Stability expectations

- `blazeplot` and the documented subpath exports are intended to stay stable within a major version.
- Built-in plugin options may grow over time, but existing option names should be preserved when practical.
- Low-level renderer/backend types are the most likely to change before a future backend is added.
- Deprecated names may stay as aliases for at least one minor version when that does not create maintenance risk.
- Generated docs and package export smoke tests should reflect the shipped package, not only source files.

## Upgrade checklist for users

1. Read the changelog for every version between your current version and target version.
2. Check the [API reference](./api-reference.md) for renamed, moved, or newly added exports.
3. Run your chart interaction flows, not just unit tests. Pan, zoom, tooltips, selection, screenshots, and exports can depend on browser behavior.
4. If you use custom datasets, re-check the assumptions in [Data semantics](./data-semantics.md).
5. If you use React, verify chart mount/unmount behavior and that options passed to `BlazeChart` are stable enough to avoid unintended recreation.
6. If you use subpath imports, run your bundler against the production build so export-map mistakes are caught early.

## Migration-risk checklist

Use this when reviewing a PR that changes public behavior.

| Area | What to verify |
|---|---|
| Package exports | `package.json#exports`, generated declarations, README/API reference, and `bun run test:exports`. |
| Dataset contracts | Sorted X expectations, gap behavior, bounds, picking, export helpers, and accelerated methods. |
| Chart lifecycle | `start()`, `stop()`, `dispose()`, ResizeObserver cleanup, plugin disposers, context restore. |
| Interaction behavior | Wheel/pointer/touch gestures, axis dragging, box zoom, double-click reset, keyboard focus. |
| Visual output | Pixel-visible browser tests for affected chart types and overlays. |
| Bundle size | `bun run test:bundle-size` and aggregate runtime-size notes when chunking changes. |
| Docs | Examples include complete imports, lifecycle cleanup, and regenerated README/API docs when public symbols change. |

## Deprecation guidance

When replacing a public API:

1. Add the new API first.
2. Keep the old name as an alias when practical.
3. Document the replacement in the changelog and affected guide page.
4. Add test coverage for both old and new names while the alias exists.
5. Remove the old name only in a major release, or when the old name was never documented and keeping it creates real risk.

Prefer warnings in docs and release notes over runtime console warnings in hot paths. Chart rendering and ingestion code should avoid per-frame deprecation work.

## For maintainers changing public APIs

1. Prefer additive options and subpath exports.
2. Keep old names as aliases when practical.
3. Document behavior changes in `changelogs/vX.Y.Z.md`.
4. Regenerate generated docs with `bun run docs:readme`.
5. Add unit, visual, interaction, or package export coverage for migration-sensitive behavior.
6. Run the relevant checks from [Local development](./internal/local-development.md) before opening the PR.

Release commands and benchmark notes live in [Release and benchmark notes](./release-and-benchmarks.md). Release PR steps live in [Internal release checklist](./internal/release-checklist.md).
