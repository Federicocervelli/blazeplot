# Release checklist

Use this checklist for the release PR that publishes a new npm version from `main`.

Related workflow reference: [GitHub workflow runbook](./github-workflows.md).

## 1. Prepare the candidate on a release branch

```bash
git checkout main
git pull --ff-only
git checkout -b release/vX.Y.Z
bun install
bun run release patch      # or minor / major
```

This bumps `package.json`, drafts `changelogs/vX.Y.Z.md` from the commits since the last tag, and regenerates `dist/`, `docs/api-reference.md`, and the README docs block. Edit the changelog into user-facing notes, add the release to the top of the list in the root `CHANGELOG.md`, and commit. Benchmark tables are appended by the release workflow.

## 2. Open the release PR

Push the branch and open a PR to `main`. CI runs `bun run check` (typecheck, lint, unit tests with coverage floors, build, generated-docs and snippet checks, package contents and exports checks, the public API snapshot, bundle budgets), the TypeScript 5.0 floor check, the browser suites (`bun run test:browser`), and the Firefox/WebKit smoke job, so there is no need to repeat them locally. If the release changes the public API, the PR must already contain the regenerated `api/public-api.md` (`bun run build && bun run test:api -- --update`). Mention any known risk areas, especially rendering, package exports, or release workflow changes.

## 3. Merge and monitor

Squash-merge the PR. Then `.github/workflows/release.yml`:

1. `version`: reads `package.json` and computes `vX.Y.Z`; skips publishing if that tag exists.
2. `ci`: runs the full CI workflow as a gate before publishing.
3. `release`: appends release benchmarks if missing.
4. `release`: publishes to npm with provenance (trusted publishing).
5. `release`: creates the tag and GitHub Release.
6. `pages`: deploys GitHub Pages once, so the stable site moves to the new tag.

Monitor:

- GitHub Actions release job.
- npm package page for the new version.
- GitHub Releases for the matching tag.
- GitHub Pages deployment for the stable site and the `/next/` preview.

## Rollback notes

npm versions cannot be overwritten. If a bad version publishes, prepare a new patch version with the fix and document the issue in the next changelog. Only delete tags/releases when no npm publish happened.
