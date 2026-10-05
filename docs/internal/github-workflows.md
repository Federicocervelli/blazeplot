# GitHub workflow runbook

What each GitHub Actions workflow owns and what to check before changing it.

## Branch flow

- `main` is the default branch and the stable line. Contributors (including forks) open pull requests against it; CI runs automatically and needs no secrets.
- `v1` is a temporary long-lived integration branch for the 1.0 release candidates. 1.0 work branches from it and its pull requests target it. CI runs for pull requests to either branch. It is deleted after 1.0 ships.
- Feature pull requests are squash-merged, and merged branches are deleted automatically. Sync pull requests between `main` and `v1` use merge commits instead (see [Release and benchmark notes](../release-and-benchmarks.md#the-v1-branch-10-release-candidates)).
- A stable release is a pull request from a `release/vX.Y.Z` branch that bumps `package.json`. Merging it into `main` publishes that version to npm `latest`.
- A release candidate is a pull request from a `release/vX.Y.Z-rc.N` branch cut from `v1`. Merging it into `v1` publishes that version to npm `rc`.
- Dependabot targets `main`.

## Shared setup

`.github/actions/setup` is the one place that installs tooling. It reads the Bun version from `package.json#packageManager`, caches `~/.bun/install/cache`, and runs `bun install --frozen-lockfile`. Bump Bun by changing `packageManager` only.

Keep permissions minimal: write scopes belong only to jobs that publish, deploy, or tag.

## CI

File: `.github/workflows/ci.yml`

Runs on pull requests targeting `main` or `v1`, when the release workflow is about to publish, and by manual dispatch. Ordinary pushes to `main` or `v1` do not rerun it: branch protection requires an up-to-date, passing pull request first. Superseded runs on the same pull request are cancelled.

| Job | Command | Covers |
|---|---|---|
| `checks` | `bun run check` | Typecheck, Oxlint, unit tests with coverage floors, library build, generated-docs freshness, doc snippet types, package exports, package contents, public API snapshot (`api/public-api.md`), bundle budgets. |
| `typescript-floor` | `bun run build && bun run test:typescript-floor` | Packs the built package, installs the tarball into a temp consumer project with TypeScript 5.0.4 (the documented minimum) and the latest 5.x, and typechecks a file importing every `package.json#exports` entry with `skipLibCheck: false` under `bundler`, `node16`, and legacy `node10` resolution. Separate from `checks` because it installs TypeScript from npm and needs network. |
| `changes` | — | Pull requests whose changed files are all under `docs/` or `changelogs/`, or are `.md` files, set `engine=false`, which skips the `browser` shards and `cross-browser`. Any other change, a failed or oversized file listing, `workflow_call`, and manual dispatch run everything. |
| `browser` (matrix) | see below | The Chrome suites as five parallel shards on separate runners, so wall time is the slowest shard rather than the sum. `fail-fast` is off so one failing shard does not hide another. The visual shards always upload `build/visual-tests` (screenshots, `actual/` baseline candidates rendered on the runner, `diff/` for failing baselines; kept 14 days). See [Visual pixel baselines](./local-development.md#visual-pixel-baselines). |
| `website` | `bun run test:website` | Website UX tests against the dev server and the production build. Always runs, including for docs-only changes, because the site renders the markdown docs. |
| `cross-browser` | `bun run test:cross-browser` | Firefox and WebKit (Playwright) smoke: WebGL2, non-blank render, hover/wheel/pan/box-zoom/reset. Browsers are installed with `bunx playwright install --with-deps firefox webkit` and cached in `~/.cache/ms-playwright`; Firefox runs headed under `xvfb-run` to get software WebGL2. Uploads `build/cross-browser` when it fails. Unlike the other checks it is not part of `bun run ci` because it needs the Playwright browsers. |
| `validate` | — | Passes only when every job above passed. Jobs skipped by `changes` count as passing, but a skip without a docs-only `changes` result, and any failed or cancelled shard, fails it. This is the single required status check for branch protection, so adding or splitting jobs does not require settings changes. |

Browser shards (the `matrix.shard` values in `ci.yml`). Together they run exactly what `bun run test:browser` runs serially:

| Shard | Command | Notes |
|---|---|---|
| `perf` | `bun run test:browser:perf` | Benchmark smoke plus the performance gate. Alone on its runner because it is timing sensitive. |
| `visual-gl` | `bun run test:browser:visual-gl` | Visual cases in the `webgl2` and `shared` renderer modes. Uploads `visual-tests-visual-gl` (the pixel baselines come from this shard). |
| `visual-fallback` | `bun run test:browser:visual-fallback` | Visual cases in the `canvas2d` and `auto-no-webgl` modes. Uploads `visual-tests-visual-fallback`. |
| `interaction-a11y` | `bun run test:browser:ui` | Interaction (CDP input events) and axe accessibility tests. |
| `stability` | `bun run test:stability` | Leak and stability suite. Alone on its runner because it is timing and memory sensitive. |

Every job has a `timeout-minutes` cap so a hung browser fails in minutes instead of the 6-hour default. When you add a check, add it to `test:browser` and to one shard script (or a new matrix shard) so CI runs it; keep them in sync.

`bun run ci` runs the `checks` and `browser` groups locally; run `bun run test:cross-browser` for the `cross-browser` job and `bun run test:typescript-floor` (after `bun run build`) for the `typescript-floor` job. Add new checks to the `check` or `test:browser` scripts in `package.json`, not to the workflow, so local and CI runs stay identical.

## Release

File: `.github/workflows/release.yml`

Runs on pushes to `main` and `v1`, and by manual dispatch. The branch decides the channel:

| Branch | Version in `package.json` | Result |
|---|---|---|
| `main` | `x.y.z` | Publishes to npm `latest`, creates a normal GitHub release, deploys Pages. |
| `main` | `x.y.z-rc.N` | Never published (a prerelease can not reach `latest`). Notice only; Pages still deploys. |
| `v1` | `x.y.z-rc.N` | Publishes to npm `rc`, creates a GitHub pre-release (never marked Latest). Pages is not deployed. |
| `v1` | `x.y.z` | Never published, for example after merging `main` into `v1` brought in a stable version. Notice only. |
| any other branch (manual dispatch) | any | Never published. |

Any other version shape (for example `-beta.1`) fails the `version` job.

1. `version`: reads `vX.Y.Z[-rc.N]` from `package.json` and applies the table above. If the tag exists there is nothing to publish; if npm has the version but the tag is missing, it fails for manual investigation.
2. `ci`: runs the full CI workflow (`workflow_call`), only when publishing.
3. `release`: appends release benchmarks to `changelogs/vX.Y.Z.md` if missing.
4. `release`: packs and publishes to npm with provenance through npm trusted publishing (OIDC), always with an explicit `--tag` (`latest` or `rc`). No npm token secret is used; the trusted publisher on npm is bound to this workflow file name (not to a branch), so `v1` publishes need no extra npm entry.
5. `release`: creates the tag and GitHub release from the changelog plus the commit list. Release candidates use `--prerelease --latest=false`. Stable notes list commits since the last stable tag; rc notes since the last tag of any kind.
6. `pages`: calls the Pages workflow, only for `main`. This is the only Pages deploy for `main`: it runs right after `version` for ordinary merges and after the tag is created for releases, so a release never deploys a stable site built from the previous tag.

Every other push to `main` skips CI and publishing and only deploys Pages, because its `package.json` version already has a tag. Every other push to `v1` skips everything for the same reason.

## Pages

File: `.github/workflows/pages.yml`

Called by the release workflow on every push to `main` (never for `v1`), and by manual dispatch. It has no push trigger of its own. Builds two sites into one Pages artifact:

- The latest stable `vX.Y.Z` release tag at `/`, so the stable docs match what is on `npm i blazeplot` (`latest`). `-rc.N` tags are ignored, so until 1.0 ships the stable site documents the last 0.x release and `/next/` documents `main`.
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
| Release skips publish with a "not published from" notice | Version kind does not match the branch (rc on `main`, stable on `v1`) | Expected. After merging `main` into `v1`, keep `v1`'s rc version in `package.json`. |
| Release fails because the npm version exists | npm published but tag is missing | Investigate manually; never overwrite npm. Release a patch if needed. |
| Browser tests cannot find Chrome locally | Browser path detection | Set `BLAZEPLOT_BENCH_CHROME` or `CHROME_PATH`. |
