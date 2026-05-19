# Versioning and migration

BlazePlot follows npm semver:

- patch: bug fixes and compatible behavior/performance improvements,
- minor: new APIs, chart types, plugins, or options that remain backward compatible,
- major: intentional breaking API or runtime behavior changes.

## Release flow

Normal work lands on `development`. Release PRs merge `development` into `main`; publishing is handled by the release workflow when `package.json` contains an unpublished version.

See [release-and-benchmarks.md](./release-and-benchmarks.md) for exact commands.

## Migration guidance

When changing public APIs:

1. Prefer additive options and subpath exports.
2. Keep old names as aliases for at least one minor version when practical.
3. Document behavior changes in `changelogs/vX.Y.Z.md`.
4. Regenerate README API tables with `bun run docs:readme`.
5. Add tests or browser smoke coverage for migration-sensitive behavior.

## Stability notes

- Core `blazeplot` exports are intended to be stable within a major line.
- Built-in plugin subpaths can evolve independently but should preserve option names where possible.
- Low-level rendering/backend types are more likely to change before a future WebGPU backend.
