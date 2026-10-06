# Benchmarks

`bun run bench:compare` runs the public comparison benchmark for BlazePlot (WebGL and Canvas 2D), uPlot, and Chart.js in a real headed browser. After launch the run is fully automatic: the script builds the comparison page (a production bundle), serves it, opens Chrome/Chromium/Brave with remote debugging, loads one fresh browser context per scenario/library/run, aggregates the medians, closes the browser, and overwrites the latest result files.

```bash
BLAZEPLOT_REAL_GPU=1 BLAZEPLOT_BENCH_CHROME=/path/to/chrome bun run bench:compare
```

The suite has 18 scenarios in four groups: setup (100k and 1M initial render, cold first chart), series types (1M line pan, 1M streaming, 10M accelerated pan, 10x100k and 100x20k multi-series, area, scatter, bars, dual axis), interaction (hover latency, resize latency), and lifecycle (50 small charts, mount/destroy cycles, heap growth, maximum sustained streaming rate). The exact list, metrics, and the primary metric of each scenario live in `scripts/benchmark-config.json`. The methodology and the fairness rules are documented in [docs/internal/benchmarks.md](../docs/internal/benchmarks.md#library-comparison-methodology).

Outputs:

- `benchmarks/latest.json` — machine-readable latest official local result (per-scenario, per-library aggregates with median, p95, min, max, spread, and every raw run value).
- `benchmarks/latest.md` — markdown report: scoreboard, "Where BlazePlot does not win", every metric per scenario, and, when a baseline exists, the change since the baseline.
- `benchmarks/latest-runs.jsonl` — one line per page run, for debugging and for `--aggregate-only`.
- `benchmarks/baseline-before-perf-pass.json` / `.md` — frozen "before" result of the performance pass; later reports compare against it automatically.

The benchmark is manual-only and is not part of CI. CI keeps using the separate headless `bun run bench:ci` smoke benchmark for regressions. `bun run bench:compare:smoke` is a harness self-test (headless software GL, tiny data, one run, writes `build/compare-smoke/`); its numbers mean nothing. Public README/docs numbers come from a publishable `benchmarks/latest.json` generated on the official local machine.

Useful options:

```bash
bun run bench:compare -- --scenario line-1m-pan,hover-1m --library blazeplot,uplot --runs 3 --out-dir build/compare-debug
bun run bench:compare -- --width 1600 --height 900
bun run bench:compare -- --setup-warmup-runs 2
bun run bench:compare -- --aggregate-only benchmarks/latest-runs.jsonl
```

A result is marked non-publishable if the browser is headless, the detected WebGL renderer appears to be software-rendered (for example SwiftShader/llvmpipe), DPR is not 1, fewer than 5 runs were taken, the run omits any official scenario/library, any library/scenario failed, or the libraries' plot areas differ. `bun run docs:readme` refuses to publish README comparison tables from a non-publishable `benchmarks/latest.json`.

Commit only the blessed `latest.json`, `latest.md`, and baseline files from the official machine. Use `--out-dir build/...` for debug or throwaway runs.
