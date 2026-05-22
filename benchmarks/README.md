# Benchmarks

`bun run bench:compare` runs the public comparison benchmark for BlazePlot, uPlot, and Chart.js in a real headed browser. After launch, the run is fully automatic: the script starts Vite, opens Chrome/Chromium/Brave with remote debugging, prewarms each selected library with a dense chart after module load, runs one discarded setup warmup per library/scenario, drives every measured scenario, closes the browser, and overwrites the latest result files. The default scenario set includes setup, pan, streaming, and a dense 10M-point pan stress case to expose FPS/work-time gaps at high data volumes. The 10M case uses BlazePlot's best-practice accelerated dataset path rather than forcing BlazePlot through raw-array scans.

```bash
bun run bench:compare
```

Outputs:

- `benchmarks/latest.json` — machine-readable latest official local result.
- `benchmarks/latest.md` — markdown summary of the same result.

The benchmark is manual-only and is not part of CI. CI keeps using the separate headless `bun run bench:ci` smoke benchmark for regressions. Public README/docs numbers should come from a publishable `benchmarks/latest.json` generated on the official local machine.

Useful options:

```bash
bun run bench:compare -- --scenario line-1m-pan --library blazeplot,uplot,chartjs
bun run bench:compare -- --width 1600 --height 900 --measure-ms 5000
bun run bench:compare -- --initial-delay-ms 2000
bun run bench:compare -- --setup-warmup-runs 2
BLAZEPLOT_BENCH_CHROME=/path/to/chrome bun run bench:compare
```

A result is marked non-publishable if the browser is headless, the detected WebGL renderer appears to be software-rendered (for example SwiftShader/llvmpipe), the run omits any official scenario/library, or any library/scenario run fails. `bun run docs:readme` refuses to publish README comparison tables from a non-publishable `benchmarks/latest.json`.

Commit only the blessed latest files (`latest.json` and `latest.md`) from the official machine. Use `--out-dir build/...` for debug or throwaway runs.
