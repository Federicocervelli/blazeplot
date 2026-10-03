# GitHub workflow runbook

What each GitHub Actions workflow owns and what to check before changing it.

## Branch flow

- `main` is the only long-lived branch and the default branch. Contributors (including forks) open pull requests against it; CI runs automatically and needs no secrets.
- Pull requests are squash-merged, and merged branches are deleted automatically.
- A release is a pull request from a `release/vX.Y.Z` branch that bumps `package.json`. Merging it publishes that version.
- Dependabot targets `main`.

## Shared setup

`.github/actions/setup` is the one place that installs tooling. It reads the Bun version from `package.json#packageManager`, caches `~/.bun/install/cache`, and runs `bun install --frozen-lockfile`. Bump Bun by changing `packageManager` only.

Keep permissions minimal: write scopes belong only to jobs that publish, deploy, or tag.

## CI

File: `.github/workflows/ci.yml`

Runs on every pull request, when the release workflow is about to publish, and by manual dispatch. Ordinary pushes to `main` do not rerun it: branch protection requires an up-to-date, passing pull request first. Superseded runs on the same pull request are cancelled.

| Job | Command | Covers |
|---|---|---|
| `checks` | `bun run check` | Typecheck, unit tests, library build, generated-docs freshness, doc snippet types, package exports, package contents, bundle budgets. |
| `browser` | `bun run test:browser` | Benchmark smoke, visual tests, interaction tests, website UX tests in headless Chrome. Uploads `build/visual-tests` when it fails. |
| `validate` | — | Passes only when every job above passed. This is the single required status check for branch protection, so adding or splitting jobs does not require settings changes. |

`bun run ci` runs both groups locally. Add new checks to the `check` or `test:browser` scripts in `package.json`, not to the workflow, so local and CI runs stay identical.

## Release

File: `.github/workflows/release.yml`

Runs on pushes to `main` and by manual dispatch.

1. `version`: reads `vX.Y.Z` from `package.json`. If the tag exists there is nothing to publish; if npm has the version but the tag is missing, it fails for manual investigation.
2. `ci`: runs the full CI workflow (`workflow_call`), only when publishing.
3. `release`: appends release benchmarks to `changelogs/vX.Y.Z.md` if missing.
4. `release`: packs and publishes to npm with provenance through npm trusted publishing (OIDC). No npm token secret is used; the trusted publisher on npm is bound to this workflow file name.
5. `release`: creates the `vX.Y.Z` tag and GitHub release from the changelog plus the commit list.
6. `pages`: calls the Pages workflow. This is the only Pages deploy for `main`: it runs right after `version` for ordinary merges and after the tag is created for releases, so a release never deploys a stable site built from the previous tag.

Every other push to `main` skips CI and publishing and only deploys Pages, because its `package.json` version already has a tag.

## Pages

File: `.github/workflows/pages.yml`

Called by the release workflow on every push to `main`, and by manual dispatch. It has no push trigger of its own. Builds two sites into one Pages artifact:

- The latest `v*` release tag at `/`, so the stable docs match what is on npm.
- `main` at `/next/`, for unreleased work.

The stable build is cached by the release tag's commit, so it is only rebuilt on the first deploy after a release. Bump the `v1` segment of its cache key when the stable build steps change, to force a rebuild.

Keep the copy step in sync with website routes that need SPA fallbacks, such as `/previews` and `/next/previews`.

## Cloudflare Pages Preview

File: `.github/workflows/cloudflare-pages-preview.yml`

Manual dispatch only. Builds the website for the selected branch and deploys it to the `blazeplot` Cloudflare Pages project, giving the branch a preview alias such as `fix-idempotent-chart-start.blazeplot.pages.dev`. It requires the `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` secrets and skips with a notice when they are absent.

Do not dispatch it for unreviewed external-contributor branches: the job runs with Cloudflare credentials.

## Workflow change checklist

- Keep the minimum permissions each job needs.
- Validate YAML before pushing; syntax errors only surface after push.
- For release changes, read the full diff; publishing cannot be undone.
- If package contents, exports, or publish behavior changed, run `bun run test:package` and `bun run test:exports`.

## Common failures

| Symptom | Likely cause | Fix |
|---|---|---|
| `bun install --frozen-lockfile` fails | `package.json` and `bun.lock` disagree | Run `bun install` and commit the lockfile. |
| `checks` fails on generated docs | Public API changed without regenerating docs | Run `bun run docs:readme` and commit the result. |
| Pages deploys but `/next/...` routes 404 | Vite base or artifact assembly changed | Rebuild `main` with `BLAZEPLOT_PAGES_BASE=/next/` and keep SPA fallback copies. |
| Release skips publish | Tag `vX.Y.Z` already exists | Expected on reruns. Bump the version for a new publish. |
| Release fails because the npm version exists | npm published but tag is missing | Investigate manually; never overwrite npm. Release a patch if needed. |
| Browser tests cannot find Chrome locally | Browser path detection | Set `BLAZEPLOT_BENCH_CHROME` or `CHROME_PATH`. |
