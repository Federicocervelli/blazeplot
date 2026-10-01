# Contributing to BlazePlot

Thanks for helping improve BlazePlot. The project is still moving quickly, so the most useful contributions are focused, source-checked, and easy to review.

## Workflow

1. Fork the repository (or create a branch if you have write access).
2. Branch from `development`, the default branch.
3. Open a pull request against `development`. Keep it focused on one topic.

CI runs on every pull request, including from forks, and needs no secrets. The required `validate` check passes when both CI jobs pass: `bun run check` and `bun run test:browser`. Maintainers merge green pull requests into `development`; releases are promoted from `development` to `main` separately.

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

## Maintainer notes

- `main` is the release branch. Merge release PRs from `development` with a merge commit; the release workflow publishes the unpublished `package.json` version, tags it, and fast-forwards `development` to `main`.
- Tags are release outputs, not manual inputs.
- See [`docs/internal/github-workflows.md`](docs/internal/github-workflows.md) for what each workflow does.
