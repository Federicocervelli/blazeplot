# BlazePlot documentation map

Use this map to decide where a topic belongs before adding or moving documentation.

## Reader paths

| Reader goal | Start with | Then read |
|---|---|---|
| Decide whether BlazePlot fits an app | [Overview](./overview.md) | [Browser support](./browser-support.md), [Performance recipes](./performance-recipes.md) |
| Build the first chart | [Overview](./overview.md) | [Examples](./examples.md), [Troubleshooting](./troubleshooting.md) |
| Stream or downsample data | [Live data](./live-data.md) | [Data semantics](./data-semantics.md), [Performance recipes](./performance-recipes.md), [Examples](./examples.md#live-line-chart) |
| Add interaction or overlays | [Built-in plugins](./built-in-plugins.md) | [Theming and layout](./theming-and-layout.md), [Plugin authoring](./plugin-authoring.md) |
| Build a dashboard | [Examples](./examples.md#linked-charts) | [Built-in plugins](./built-in-plugins.md), [Performance recipes](./performance-recipes.md) |
| Debug a chart | [Troubleshooting](./troubleshooting.md) | [Browser support](./browser-support.md), [Data semantics](./data-semantics.md) |
| Upgrade or review API changes | [Versioning and migration](./versioning-and-migration.md) | [API reference](./api-reference.md), changelogs |
| Maintain releases and docs | [Internal local development](./internal/local-development.md) | [Release checklist](./internal/release-checklist.md), [GitHub workflows](./internal/github-workflows.md) |

## Public docs

These pages are visible on the docs site and should be useful to package users.

### Start here

- [Overview](./overview.md) — install, first chart, main tradeoffs.
- [Examples](./examples.md) — copy-paste usage patterns for app developers.
- [Troubleshooting](./troubleshooting.md) — common blank-chart, lifecycle, live viewport, React, and screenshot failures.

### Data and performance

- [Live data](./live-data.md) — streaming appends, fixed-rate shorthand, sample updates, OHLC live candles, and follow-latest behavior.
- [Data semantics](./data-semantics.md) — sorted X values, gaps, bounds, ring buffers, server-sampled data, picking, and export behavior.
- [Performance recipes](./performance-recipes.md) — data-shape choices, LOD guidance, streaming patterns, and browser budgets.
- [Benchmarks](./benchmarks.md) — generated headed-browser comparison tables from the latest publishable local run.

### UI and extension

- [Built-in plugins](./built-in-plugins.md) — interactions, tooltip, legend, annotations, selection, crosshair, navigator, and linked charts.
- [Theming and layout](./theming-and-layout.md) — theme tokens, axes, gutters, mobile layouts, and screenshot/export layout behavior.
- [Plugin authoring](./plugin-authoring.md) — public plugin lifecycle and layout contracts.

### Reference

- [Browser support](./browser-support.md) — WebGL2 requirements, unsupported-browser fallbacks, SSR, clipboard, and downloads.
- [Versioning and migration](./versioning-and-migration.md) — semver policy, upgrade checklist, migration-risk review, and deprecation guidance.
- [Roadmap](./roadmap.md) — current status, priorities, and non-goals.
- [API reference](./api-reference.md) — generated package entry points, bundle-size table, and public exports.

## Maintainer docs

These pages are primarily for contributors and release maintainers.

- [Documentation contributions](./documentation-contributions.md) — docs writing standards, verification, and page ownership.
- [Release and benchmark notes](./release-and-benchmarks.md) — release branch policy, benchmark commands, and generated table expectations.
- [Internal local development](./internal/local-development.md) — setup, daily validation commands, browser-backed checks, package checks.
- [Internal release checklist](./internal/release-checklist.md) — release PR checklist and monitoring steps.
- [Internal GitHub workflow runbook](./internal/github-workflows.md) — CI, Pages, release workflow ownership, and failure modes.
- [Internal benchmark notes](./internal/benchmarks.md) — benchmark methodology.
- [Internal benchmark results](./internal/benchmark-results.md) — historical benchmark output.

## Organization rules

- Keep first-use docs in `overview.md` or `examples.md`.
- Keep correctness rules in `data-semantics.md`.
- Keep performance decisions in `performance-recipes.md`.
- Keep plugin usage in `built-in-plugins.md`; custom plugin lifecycle belongs in `plugin-authoring.md`.
- Keep maintainer-only process in `documentation-contributions.md` or `docs/internal/*`.
- Do not hand-edit generated sections in `README.md`, `docs/api-reference.md`, or `docs/benchmarks.md`; run `bun run docs:readme` instead.
