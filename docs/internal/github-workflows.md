# GitHub workflow runbook

This runbook explains what each GitHub Actions workflow owns and what to check before changing it.

## Shared conventions

- Workflows pin Bun through the top-level `BUN_VERSION` environment variable.
- Keep `package.json#packageManager`, `BUN_VERSION` in workflows, and maintainer docs in sync when changing Bun versions.
- Workflows cache `~/.bun/install/cache`; they still run `bun install --frozen-lockfile` so the lockfile remains authoritative.
- Keep permissions minimal. Add write scopes only to jobs that need to publish, deploy, tag, or comment.

## CI

File: `.github/workflows/ci.yml`

Runs for pull requests into `main` or `development`, and by manual dispatch.

It performs:

1. Checkout.
2. Bun setup and cache restore.
3. `bun install --frozen-lockfile`.
4. `bun run ci`.

`bun run ci` is intentionally broad: typecheck, unit tests, package build, export/package/bundle checks, benchmark smoke, visual tests, and interaction tests. If CI gets too slow, split the workflow into separate jobs rather than quietly removing checks from `bun run ci`.

## Pages

File: `.github/workflows/pages.yml`

Runs on pushes to `main` or `development`, and by manual dispatch.

It builds both branch previews in one deployment artifact:

- `main` at `/`
- `development` at `/development/`

The workflow checks out both branches into `branches/main` and `branches/development`, builds each site with its correct Vite base, then assembles one Pages artifact. Keep the copy step in sync with website routes that need duplicate SPA fallbacks, such as `/previews` and `/development/previews`.

## Release

File: `.github/workflows/release.yml`

Runs on pushes to `main`, and by manual dispatch.

It only publishes when `package.json` contains a version whose tag does not already exist. The release job:

1. Runs full CI.
2. Computes `vX.Y.Z` from `package.json`.
3. Skips publish if the tag already exists.
4. Fails if npm already has the version but the git tag is missing.
5. Appends release benchmarks if missing.
6. Packs and publishes to npm with provenance.
7. Creates the git tag and GitHub Release.

The release workflow supports both an `NPM_TOKEN` secret and npm trusted publishing/OIDC. If neither is configured correctly, publish will fail after CI and before tag creation.

## Workflow change checklist

Before merging workflow changes:

- Confirm the changed workflow still has the minimum permissions it needs.
- Confirm Bun version changes are reflected in `package.json#packageManager` and docs.
- Run `bun run typecheck` and `bun run pages:build` for docs/workflow documentation changes.
- For release workflow changes, inspect the generated YAML diff carefully; syntax errors only show up in GitHub Actions after push.
- If package contents, exports, or publish behavior changed, run `bun run test:package` and `bun run test:exports`.

## Common failures

| Symptom | Likely cause | Fix |
|---|---|---|
| `bun install --frozen-lockfile` fails | `package.json` and `bun.lock` disagree | Run `bun install`, commit the lockfile change, and rerun checks. |
| Pages deploys but `/development/...` routes 404 | Vite base or artifact assembly changed | Rebuild development with `BLAZEPLOT_PAGES_BASE=/development/` and keep SPA fallback copies. |
| Release skips publish | Matching `vX.Y.Z` tag already exists | This is expected for reruns. Bump the version for a new publish. |
| Release fails because npm version exists | npm published but tag is missing | Investigate manually; do not overwrite npm. Create a patch release if needed. |
| Browser tests cannot find Chrome | Runner/browser path changed | Set `BLAZEPLOT_BENCH_CHROME` or update browser detection docs/scripts. |
