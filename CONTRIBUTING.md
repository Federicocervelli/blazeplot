# Contributing to BlazePlot

Thanks for helping improve BlazePlot. The project is still moving quickly, so the most useful contributions are focused, source-checked, and easy to review.

## Workflow

1. Fork the repository (or create a branch if you have write access).
2. Branch from `main`.
3. Open a pull request against `main`. Keep it focused on one topic.

CI runs on every pull request, including from forks, and needs no secrets. The required `validate` check passes when both CI jobs pass: `bun run check` and `bun run test:browser`. Maintainers squash-merge green pull requests into `main`. Merging to `main` does not publish to npm; releases are separate PRs that bump the version.

## Local setup

Use Bun for development:

```bash
bun install
bun run typecheck
bun test
bun run build
```

For a fuller command reference, see [`docs/internal/local-development.md`](docs/internal/local-development.md).

For browser-backed benchmarks and visual/interaction tests, set Chrome explicitly when needed:

```bash
export BLAZEPLOT_BENCH_CHROME=/path/to/chrome
bun run test:visual
bun run test:interaction
bun run test:stability
```

## Before opening a pull request

| Change type | Run |
|---|---|
| Any change | `bun run check` (typecheck, unit tests, build, docs freshness, package checks) |
| Rendering, plugins, or website | also `bun run test:browser` (needs Chrome) |
| Public API changes | `bun run docs:readme` to regenerate the API reference, and a migration note in `docs/versioning-and-migration.md` for breaking changes |

`bun run ci` runs everything CI runs.

## Documentation standards

Documentation should be practical rather than broad marketing copy:

- Show complete imports for code snippets.
- Include lifecycle cleanup when a snippet creates a chart, timer, worker, object URL, or plugin handle.
- Verify API names against source, tests, or generated declarations.
- Prefer one complete example over several partial fragments.
- Update `docs/api-reference.md` and the generated README section through `bun run docs:readme`; do not edit those generated sections by hand.

See [`docs/documentation-contributions.md`](docs/documentation-contributions.md) for the docs-specific workflow and [`docs/internal/local-development.md`](docs/internal/local-development.md) for local validation commands.

## Pull request expectations

A good PR description includes:

- What changed and why.
- Which user/developer path it improves.
- Checks run locally.
- Screenshots or preview links for visible website/UI changes.
- Known follow-ups, if any.

## Code of conduct

Participation in this project is covered by the [Code of Conduct](CODE_OF_CONDUCT.md). By contributing you agree to follow it.

## Governance and continuity

**Current model.** BlazePlot is maintained by [Federico Cervelli](https://cervelli.dev), who is the sole maintainer and makes final decisions on scope, API design, and releases. Anyone can propose a change through an issue or pull request. There is no committee or voting process.

**How decisions are made.**

- Bug fixes, docs, and tests that match existing behavior: a pull request is enough.
- New public API, changed behavior, or anything affecting the [API stability](docs/stability.md) tiers: open an issue first and describe the use case. Breaking changes to stable APIs need a [deprecation](docs/versioning-and-migration.md#deprecation-process) path and land in a major release.
- Direction and non-goals are tracked in the [roadmap](docs/roadmap.md).

**Releases and access.** Releases are cut from pull requests that bump `package.json#version`. The release workflow publishes to npm with provenance (trusted publishing from GitHub Actions) and creates the tag and GitHub Release, so publishing does not depend on a personal npm token on a developer machine. See [`docs/internal/release-checklist.md`](docs/internal/release-checklist.md).

**Continuity.** The code is MIT licensed, so anyone can fork and continue the project. Releases can be rebuilt from the repository and its CI workflows.

**Maintenance and bus factor.** BlazePlot currently has one maintainer, so one person holds merge rights, npm publishing through the release workflow, and private vulnerability reports (see [`SECURITY.md`](SECURITY.md)). Contributors who want to help sustain the project, for example by reviewing pull requests or triaging issues, are welcome to say so in an issue.

## Maintainer notes

- Releases are PRs from a `release/vX.Y.Z` branch that run `bun run release <patch|minor|major>`. When one merges, the release workflow publishes the new `package.json` version, tags it, and redeploys the stable site.
- Tags are release outputs, not manual inputs.
- See [`docs/internal/github-workflows.md`](docs/internal/github-workflows.md) for what each workflow does.
