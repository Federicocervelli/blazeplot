# Release checklist

Use this checklist for the PR that promotes `development` to `main` and publishes a new npm version.

Related workflow reference: [GitHub workflow runbook](./github-workflows.md).

## 1. Prepare the candidate on `development`

```bash
git checkout development
git pull --ff-only
bun install
bun run version:patch      # or version:minor / version:major
```

Then update `changelogs/vX.Y.Z.md` with user-facing changes. Keep benchmark tables under the `## Benchmarks` heading.

## 2. Refresh generated release artifacts

```bash
bun run release:benchmarks
bun run docs:readme
bun run ci
```

`bun run release:benchmarks` appends benchmark tables to the current changelog. `bun run docs:readme` rebuilds `dist/`, regenerates `docs/api-reference.md`, and refreshes the generated README docs block.

## 3. Review package contents

Before opening the release PR, check that the package tarball only contains intended runtime files:

```bash
bun pm pack --dry-run
```

Look for:

- `dist/` JavaScript and declaration files.
- `README.md`, `LICENSE`, and `package.json`.
- No source maps, local benchmark output, screenshots, editor config, or workspace files.

## 4. Open the release PR

Open a PR from `development` to `main`.

Include:

- Version number and changelog link.
- The benchmark command that updated the changelog.
- Confirmation that `bun run ci` passed (it includes the website build and `bun pm pack --dry-run`).
- Any known risk areas, especially rendering, package exports, or release workflow changes.

## 5. Merge and monitor

Merge with **Create a merge commit** (not squash or rebase) so `development` stays an ancestor of `main`. Then `.github/workflows/release.yml`:

1. Runs the full CI workflow.
2. Reads `package.json` and computes `vX.Y.Z`; skips if that tag exists.
3. Appends release benchmarks if missing.
4. Publishes to npm with provenance (trusted publishing).
5. Creates the tag and GitHub Release.
6. Fast-forwards `development` to `main`.

Monitor:

- GitHub Actions release job.
- npm package page for the new version.
- GitHub Releases for the matching tag.
- GitHub Pages deployment for main/development previews.

## Rollback notes

npm versions cannot be overwritten. If a bad version publishes, prepare a new patch version with the fix and document the issue in the next changelog. Only delete tags/releases when no npm publish happened.
