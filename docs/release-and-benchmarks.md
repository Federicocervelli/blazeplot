# Release and benchmark notes

BlazePlot releases are driven by pull requests into `main`. Tags are outputs of the release workflow, not inputs.

## Branches

- `development`: integration branch for feature and fix work.
- Feature branches: branch from `development`, commit one focused change, then merge back to `development`.
- `main`: protected release branch. A merge to `main` with an unpublished `package.json` version publishes the package.

## Branch previews

GitHub Pages publishes both active branches into one site:

- Stable `main` site: <https://blazeplot.cervelli.dev/>
- Stable integrated previews: <https://blazeplot.cervelli.dev/previews>
- In-progress `development` site: <https://blazeplot.cervelli.dev/development/>
- In-progress integrated previews: <https://blazeplot.cervelli.dev/development/previews>
- Legacy `previews.html` index is not generated; use the app preview routes directly.

The Pages workflow runs on pushes to either `main` or `development`, checks out both branches, builds each Lit website with the correct Vite `base`, and deploys a combined artifact. Legacy preview routes redirect to the integrated `#previews` view.

Feature branch browser previews can be requested by maintainers with the `Cloudflare Pages Preview` manual GitHub Actions workflow. The workflow deploys the selected feature branch's website build to the `blazeplot` Pages project and exposes a branch alias:

- `https://<branch-alias>.blazeplot.pages.dev/`

Cloudflare lowercases aliases and replaces non-alphanumeric branch characters with hyphens, so `fix/idempotent-chart-start` becomes:

- `https://fix-idempotent-chart-start.blazeplot.pages.dev/`

Preview deploys are intentionally manual so arbitrary PRs do not create Cloudflare deployments just by pushing commits.

For a copy-paste release PR checklist, see [Internal release checklist](./internal/release-checklist.md). For workflow ownership and failure modes, see [GitHub workflow runbook](./internal/github-workflows.md).

## Preparing a release candidate

```bash
git checkout development
git pull --ff-only
bun run version:patch      # or version:minor / version:major
# edit changelogs/vX.Y.Z.md
bun run release:benchmarks
bun run docs:readme        # rebuild dist, regenerate docs/api-reference.md, and refresh README
bun run ci
bun run pages:build
bun pm pack --dry-run
```

Open a PR from `development` to `main` after the candidate is ready. The PR's `validate` check must pass before merge.

## What the release workflow does

On pushes to `main` and manual dispatches, `.github/workflows/release.yml`:

1. Installs with `bun install --frozen-lockfile`.
2. Runs `bun run ci`.
3. Reads `package.json` and computes `vX.Y.Z`.
4. If that tag already exists, skips publish/tag/release creation.
5. If the tag is new, verifies the npm version is unpublished.
6. Runs `bun run release:benchmarks -- --if-missing` so the release notes include benchmark tables.
7. Packs and publishes to npm with provenance.
8. Creates the `vX.Y.Z` tag and GitHub Release.

## Benchmark and bundle-size commands

- `bun run docs:readme`: rebuilds the package, regenerates `docs/api-reference.md` from `dist/`, and refreshes the generated README docs section.
- `bun run test:bundle-size`: enforces built package chunk budgets.
- `bun run docs:bundle-size`: prints the bundle-size markdown summary for the current `dist/` build.
- `bun run bundle:analyze`: reports built chunk raw/gzip sizes and source-map generated-byte contributors for investigating bundle growth. Hidden source maps remain in local `dist/` builds for this command, but `.map` files are excluded from the published npm package to keep tarballs small.
- `bun run bench:ci`: fast smoke benchmark used by CI.
- `bun run bench:compare`: manual-only headed comparison benchmark for BlazePlot, uPlot, and Chart.js. It runs automatically after launch and overwrites `benchmarks/latest.json` plus `benchmarks/latest.md`.
- `bun run test:visual`: browser visual chart tests used by CI; writes PNGs and `summary.json` to `build/visual-tests/`.
- `bun run test:interaction`: browser input automation used by CI for hover, crosshair, zoom, pan, reset, and selection.
- `bun run bench -- --scenario <name>`: run one benchmark scenario and print JSON.
- `bun run bench:report`: append benchmark tables to `docs/internal/benchmark-results.md` or a path passed with `--out-md`.
- `bun run release:benchmarks`: append benchmark tables to `changelogs/v<package.version>.md`.

Browser detection checks `BLAZEPLOT_BENCH_CHROME`, `CHROME_PATH`, then common Chrome/Chromium/Brave binaries.

## Public comparison benchmarks

Public comparison numbers are intentionally separate from CI smoke benchmarks. `bun run bench:compare` defaults to a headed browser, prewarms each selected library with a dense chart after module load, runs one discarded setup warmup per library/scenario, drives every measured scenario through Chrome DevTools Protocol, and requires no user interaction after the command starts. The latest run is stored in `benchmarks/latest.json` and summarized in `benchmarks/latest.md`; historical comparison artifacts are not kept in-repo.

The comparison suite currently covers BlazePlot, uPlot, and Chart.js across 100k/1M static line setup, 1M pan over a 100k visible window, 1M live streaming append while following the latest 100k samples, and a 10M dense-pan stress case with 5M visible samples. The 10M case intentionally uses BlazePlot's best-practice accelerated dataset path while competitors use their recommended array inputs. Results are marked non-publishable when the browser is headless, the detected WebGL renderer appears to be software-rendered, the run omits any official scenario/library, or any library/scenario run fails.

When a publishable `benchmarks/latest.json` exists, `bun run docs:readme` generates the README performance section from that file. If that file is missing, the README only documents how to run the manual benchmark and avoids public competitor numbers. If the file exists but is non-publishable, docs generation fails instead of silently promoting bad data.

## Reading release benchmark tables

The changelog benchmark table is intentionally compact:

- **RAF FPS / RAF p95 ms**: browser animation-frame cadence during the benchmark window.
- **Chart p50/p95 ms**: `Chart` frame time from internal frame stats.
- **Points**: median rendered primitives/points from `ChartFrameStats.pointsRendered`.
- **Draws**: median draw call count.
- **Batched**: median draw calls avoided by compatible internal batching.
- **Upload KB**: median GPU upload size per frame.

The CPU hot-spot table comes from the Chrome DevTools Protocol profiler. It is useful for spotting large regressions, but exact timings vary by runner/browser and should not be treated as strict performance budgets yet.

## Reading API reference bundle-size tables

The API reference and README bundle-size summary are generated by `bun run docs:readme` from the built `dist/` files. It uses the same budgets as `bun run test:bundle-size`, reports the current size for each budgeted chunk, and shows how much budget remains for each chunk.
