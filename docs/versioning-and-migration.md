# Versioning and migration

BlazePlot follows npm semver.

- Patch releases fix bugs or make compatible performance/behavior improvements.
- Minor releases add APIs, chart types, plugins, or options without intentional breaking changes.
- Major releases can change public APIs or runtime behavior in breaking ways.

## Stability expectations

- `blazeplot` and the documented subpath exports are intended to stay stable within a major version.
- Built-in plugin options may grow over time, but existing option names should be preserved when practical.
- Low-level renderer/backend types are the most likely to change before a future backend is added.
- Deprecated names may stay as aliases for at least one minor version when that does not create maintenance risk.

## When upgrading

1. Read the changelog for your target version.
2. Check the [API reference](./api-reference.md) for renamed or moved exports.
3. Run your chart interaction flows, not just unit tests. Pan, zoom, tooltips, selection, screenshots, and exports can depend on browser behavior.
4. If you use custom datasets, re-check the assumptions in [Data semantics](./data-semantics.md).

## For maintainers changing public APIs

1. Prefer additive options and subpath exports.
2. Keep old names as aliases when practical.
3. Document behavior changes in `changelogs/vX.Y.Z.md`.
4. Regenerate generated docs with `bun run docs:readme`.
5. Add unit, visual, interaction, or package export coverage for migration-sensitive behavior.

Release commands and benchmark notes live in [Release and benchmark notes](./release-and-benchmarks.md).
