# Automated browser benchmarks

Run the headless benchmark harness with:

```sh
bun run bench --scenario mixed-1m-live --out bench-result.json
```

The harness starts Vite, opens `/bench/` in headless Chrome/Chromium, waits for the chart scene to load and warm up, starts the Chrome CPU profiler, runs the scenario, then prints a JSON report. The report includes chart/RAF FPS summaries, frame timing, draw/upload stats, Chrome performance metrics, and a top-N bottom-up CPU profile table.

Useful options:

```sh
bun run bench -- --help
bun run bench --scenario line-5m-static --measure-ms 10000 --top 80
bun run bench --scenario mixed-10m-live --setup-timeout-ms 240000 --out bench-10m.json
```

If Chrome/Chromium/Brave is not on `PATH`, pass `--chrome /path/to/browser` or set `BLAZEPLOT_BENCH_CHROME`. For Brave installed at `/usr/bin/brave`:

```sh
bun run bench --scenario mixed-1m-live --chrome /usr/bin/brave --out bench-result.json
```

Built-in scenarios live in `preview/bench/main.ts`:

- `mixed-1m-live` (default): line + scatter + bars with live appends.
- `line-5m-static`: static downsampled line scene.
- `mixed-10m-live`: heavier version of the preview-style mixed live scene.

The benchmark page exposes `window.__blazeplotBench` for automation. It does not start measurement until the harness calls `start()`, so the emitted CPU profile covers only the measured interval rather than initial data loading.
