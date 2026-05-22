# Latest BlazePlot comparison benchmark

Generated: 2026-05-22T15:20:02.565Z
Command: `bun run bench:compare --width 1600 --height 900`
Publishable: yes

## Environment

- Machine: local machine; AMD Ryzen 5 5600H with Radeon Graphics; 12 logical CPUs; 15.5 GiB RAM
- OS: linux 7.0.9-1-cachyos x64
- Browser: Chrome/148.0.7778.167
- Executable: brave
- GPU/WebGL: ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3050 Laptop GPU/PCIe/SSE2, OpenGL 4.5.0)
- Canvas: 1600×900 CSS px; DPR 1
- Library prewarm: 317.4 ms before measured runs
- Setup warmup runs: 1 discarded run(s) before each measured library/scenario

## Scenario data preparation

| Scenario | Description | Samples | Visible samples | Data prep ms |
|---|---|---:|---:|---:|
| line-100k-static | 100k point line, initial render | 100,000 | 100,000 | 7.3 |
| line-1m-static | 1M point line, initial render | 1,000,000 | 1,000,000 | 101.7 |
| line-1m-pan | 1M point line, automated pan over 100k visible samples | 1,000,000 | 100,000 | 101.3 |
| line-1m-stream | 1M point line, live append while following latest 100k samples | 1,000,000 | 100,000 | 75.2 |
| line-10m-accelerated-pan | 10M point line, automated pan over 5M visible samples using BlazePlot's accelerated dataset path | 10,000,000 | 5,000,000 | 1291.1 |

## Initial chart ready time

Ready time includes library chart construction plus the first browser frame after shared scenario data has been prepared. Each displayed row follows the discarded setup warmup run(s) recorded in the environment section.

| Scenario | Library | Version | Ready ms | Heap after ready | First frame details |
|---|---|---:|---:|---:|---|
| line-100k-static | BlazePlot | 0.3.11 | 13.1 | 13.1 MiB | minmax, 4.70 ms render, 9,234 pts, 1 draws |
| line-100k-static | uPlot | 1.6.32 | **8.4** | 13.0 MiB | — |
| line-100k-static | Chart.js | 4.5.1 | 14.2 | 12.3 MiB | — |
| line-1m-static | BlazePlot | 0.3.11 | **16.2** | 64.1 MiB | minmax, 10.00 ms render, 9,288 pts, 1 draws |
| line-1m-static | uPlot | 1.6.32 | 24.5 | 63.0 MiB | — |
| line-1m-static | Chart.js | 4.5.1 | 27.3 | 62.4 MiB | — |
| line-1m-pan | BlazePlot | 0.3.11 | 14.0 | 74.6 MiB | minmax, 6.70 ms render, 9,234 pts, 1 draws |
| line-1m-pan | uPlot | 1.6.32 | **6.5** | 63.4 MiB | — |
| line-1m-pan | Chart.js | 4.5.1 | 13.2 | 62.7 MiB | — |
| line-1m-stream | BlazePlot | 0.3.11 | 34.3 | 63.9 MiB | minmax, 11.90 ms render, 9,234 pts, 1 draws |
| line-1m-stream | uPlot | 1.6.32 | **11.6** | 69.5 MiB | — |
| line-1m-stream | Chart.js | 4.5.1 | 13.6 | 63.2 MiB | — |
| line-10m-accelerated-pan | BlazePlot | 0.3.11 | **23.0** | 476.0 MiB | minmax, 9.90 ms render, 9,288 pts, 1 draws |
| line-10m-accelerated-pan | uPlot | 1.6.32 | 56.6 | 493.1 MiB | — |
| line-10m-accelerated-pan | Chart.js | 4.5.1 | 75.8 | 466.6 MiB | — |

## Automated pan and streaming measurements

These rows are collected without user interaction after the command starts. RAF columns measure browser frame cadence. Work columns use BlazePlot internal chart frame time when available and otherwise the synchronous library update/redraw call.

| Scenario | Library | RAF FPS | RAF p95 ms | Work p50 ms | Work p95 ms | Points p50 | Draws p50 | Appended | Heap after measure |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| line-1m-pan | BlazePlot | **120.2** | **8.40** | **0.80** | **1.20** | 9,234 | 1 | 0 | 67.6 MiB |
| line-1m-pan | uPlot | **120.2** | **8.40** | 1.80 | 2.10 | — | — | 0 | 76.9 MiB |
| line-1m-pan | Chart.js | 119.8 | **8.40** | 3.00 | 3.60 | — | — | 0 | 86.6 MiB |
| line-1m-stream | BlazePlot | **120.2** | **8.40** | **0.90** | **1.30** | 9,234 | 1 | 184,123 | 76.8 MiB |
| line-1m-stream | uPlot | **120.2** | **8.40** | 1.90 | 2.30 | — | — | 184,000 | 86.9 MiB |
| line-1m-stream | Chart.js | 119.8 | **8.40** | 3.20 | 4.00 | — | — | 184,270 | 93.0 MiB |
| line-10m-accelerated-pan | BlazePlot | **120.2** | **8.40** | **0.30** | **0.50** | 9,288 | 1 | 0 | 488.0 MiB |
| line-10m-accelerated-pan | uPlot | 21.5 | 50.00 | 45.80 | 48.40 | — | — | 0 | 480.6 MiB |
| line-10m-accelerated-pan | Chart.js | 20.5 | 50.00 | 47.80 | 51.00 | — | — | 0 | 477.3 MiB |

## BlazePlot vs uPlot runtime delta

Higher ratios favor BlazePlot. FPS ratio is BlazePlot RAF FPS divided by uPlot RAF FPS; work ratio is uPlot p95 work time divided by BlazePlot p95 work time.

| Scenario | FPS ratio | Work p95 ratio | BlazePlot FPS | uPlot FPS | BlazePlot work p95 | uPlot work p95 |
|---|---:|---:|---:|---:|---:|---:|
| line-1m-pan | 1.00× | 1.75× | 120.2 | 120.2 | 1.20 | 2.10 |
| line-1m-stream | 1.00× | 1.77× | 120.2 | 120.2 | 1.30 | 2.30 |
| line-10m-accelerated-pan | 5.58× | 96.80× | 120.2 | 21.5 | 0.50 | 48.40 |

## Failures

No library runs failed.

