# Latest BlazePlot comparison benchmark

Generated: 2026-05-22T13:43:33.116Z
Command: `bun run bench:compare --width 1600 --height 900`
Publishable: yes

## Environment

- Machine: local machine; AMD Ryzen 5 5600H with Radeon Graphics; 12 logical CPUs; 15.5 GiB RAM
- OS: linux 7.0.9-1-cachyos x64
- Browser: Chrome/148.0.7778.167
- Executable: brave
- GPU/WebGL: ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3050 Laptop GPU/PCIe/SSE2, OpenGL 4.5.0)
- Canvas: 1600×900 CSS px; DPR 1
- Library prewarm: 260.4 ms before measured runs
- Setup warmup runs: 1 discarded run(s) before each measured library/scenario

## Scenario data preparation

| Scenario | Samples | Visible samples | Data prep ms |
|---|---:|---:|---:|
| line-100k-static | 100,000 | 100,000 | 10.0 |
| line-1m-static | 1,000,000 | 1,000,000 | 135.2 |
| line-1m-pan | 1,000,000 | 100,000 | 98.4 |
| line-1m-stream | 1,000,000 | 100,000 | 75.2 |
| line-10m-pan | 10,000,000 | 5,000,000 | 1365.2 |

## Initial chart ready time

Ready time includes library chart construction plus the first browser frame after shared scenario data has been prepared. Each displayed row follows the discarded setup warmup run(s) recorded in the environment section.

| Scenario | Library | Version | Ready ms | Heap after ready | First frame details |
|---|---|---:|---:|---:|---|
| line-100k-static | BlazePlot | 0.3.11 | 11.4 | 13.1 MiB | minmax, 4.60 ms render, 9,234 pts, 1 draws |
| line-100k-static | uPlot | 1.6.32 | 8.4 | 12.9 MiB | — |
| line-100k-static | Chart.js | 4.5.1 | 13.1 | 12.3 MiB | — |
| line-1m-static | BlazePlot | 0.3.11 | 15.5 | 64.1 MiB | minmax, 8.30 ms render, 9,288 pts, 1 draws |
| line-1m-static | uPlot | 1.6.32 | 20.5 | 76.6 MiB | — |
| line-1m-static | Chart.js | 4.5.1 | 25.1 | 62.4 MiB | — |
| line-1m-pan | BlazePlot | 0.3.11 | 12.9 | 74.6 MiB | minmax, 6.40 ms render, 9,234 pts, 1 draws |
| line-1m-pan | uPlot | 1.6.32 | 8.3 | 63.3 MiB | — |
| line-1m-pan | Chart.js | 4.5.1 | 12.3 | 62.6 MiB | — |
| line-1m-stream | BlazePlot | 0.3.11 | 33.4 | 63.9 MiB | minmax, 10.70 ms render, 9,234 pts, 1 draws |
| line-1m-stream | uPlot | 1.6.32 | 11.5 | 82.9 MiB | — |
| line-1m-stream | Chart.js | 4.5.1 | 15.0 | 63.1 MiB | — |
| line-10m-pan | BlazePlot | 0.3.11 | 33.0 | 590.4 MiB | minmax, 21.60 ms render, 9,288 pts, 1 draws |
| line-10m-pan | uPlot | 1.6.32 | 60.5 | 607.4 MiB | — |
| line-10m-pan | Chart.js | 4.5.1 | 68.9 | 581.4 MiB | — |

## Automated pan and streaming measurements

These rows are collected without user interaction after the command starts. RAF columns measure browser frame cadence. Work columns use BlazePlot internal chart frame time when available and otherwise the synchronous library update/redraw call.

| Scenario | Library | RAF FPS | RAF p95 ms | Work p50 ms | Work p95 ms | Points p50 | Draws p50 | Appended | Heap after measure |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| line-1m-pan | BlazePlot | 120.2 | 8.40 | 0.90 | 1.20 | 9,234 | 1 | 0 | 67.4 MiB |
| line-1m-pan | uPlot | 114.5 | 8.40 | 1.80 | 2.50 | — | — | 0 | 75.3 MiB |
| line-1m-pan | Chart.js | 120.2 | 8.40 | 3.00 | 3.60 | — | — | 0 | 86.5 MiB |
| line-1m-stream | BlazePlot | 120.2 | 8.40 | 0.90 | 1.20 | 9,234 | 1 | 183,932 | 77.0 MiB |
| line-1m-stream | uPlot | 120.2 | 8.40 | 1.80 | 2.30 | — | — | 184,086 | 85.4 MiB |
| line-1m-stream | Chart.js | 119.8 | 8.40 | 2.90 | 3.50 | — | — | 184,197 | 96.6 MiB |
| line-10m-pan | BlazePlot | 92.9 | 16.70 | 10.10 | 10.90 | 9,288 | 1 | 0 | 579.8 MiB |
| line-10m-pan | uPlot | 22.1 | 50.00 | 44.60 | 46.90 | — | — | 0 | 586.6 MiB |
| line-10m-pan | Chart.js | 21.3 | 50.00 | 45.80 | 48.10 | — | — | 0 | 598.6 MiB |

## BlazePlot vs uPlot runtime delta

Higher ratios favor BlazePlot. FPS ratio is BlazePlot RAF FPS divided by uPlot RAF FPS; work ratio is uPlot p95 work time divided by BlazePlot p95 work time.

| Scenario | FPS ratio | Work p95 ratio | BlazePlot FPS | uPlot FPS | BlazePlot work p95 | uPlot work p95 |
|---|---:|---:|---:|---:|---:|---:|
| line-1m-pan | 1.05× | 2.08× | 120.2 | 114.5 | 1.20 | 2.50 |
| line-1m-stream | 1.00× | 1.92× | 120.2 | 120.2 | 1.20 | 2.30 |
| line-10m-pan | 4.21× | 4.30× | 92.9 | 22.1 | 10.90 | 46.90 |

## Failures

No library runs failed.

