# Contributing to BlazePlot

Thanks for helping improve BlazePlot. The project is still moving quickly, so the most useful contributions are focused, source-checked, and easy to review.

## Branches

- Branch from `development` for feature, fix, docs, and workflow changes.
- Keep pull requests focused on one topic.
- Open release-candidate pull requests from `development` to `main` only when preparing a publish.

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

Run the smallest checks that cover your change:

| Change type | Recommended checks |
|---|---|
| TypeScript/runtime code | `bun run typecheck`, `bun test`, `bun run build` |
| Package exports or packaging | `bun run test:exports`, `bun run test:package`, `bun run test:bundle-size` |
| Performance-sensitive rendering | `bun run bench:ci`, `bun run test:visual`, `bun run test:interaction` |
| Docs or website routing | `bun run docs:readme` when generated docs are affected, plus `bun run pages:build` |
| Release candidate | `bun run ci`, `bun run pages:build`, `bun pm pack --dry-run` |

`bun run ci` runs the full validation suite used by pull requests.

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

- `main` is the release branch.
- The release workflow publishes when `package.json` contains an unpublished version and the matching tag does not already exist.
- Tags are release outputs, not manual inputs.
