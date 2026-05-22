# Latest BlazePlot comparison benchmark

Generated: 2026-05-22T14:56:48.781Z
Command: `bun run bench:compare --width 1600 --height 900`
Publishable: yes

## Environment

- Machine: local machine; AMD Ryzen 5 5600H with Radeon Graphics; 12 logical CPUs; 15.5 GiB RAM
- OS: linux 7.0.9-1-cachyos x64
- Browser: Chrome/148.0.7778.167
- Executable: brave
- GPU/WebGL: ANGLE (NVIDIA Corporation, NVIDIA GeForce RTX 3050 Laptop GPU/PCIe/SSE2, OpenGL 4.5.0)
- Canvas: 1600×900 CSS px; DPR 1
- Library prewarm: 177.6 ms before measured runs
- Setup warmup runs: 1 discarded run(s) before each measured library/scenario

## Scenario data preparation

| Scenario | Samples | Visible samples | Data prep ms |
|---|---:|---:|---:|
| line-100k-static | 100,000 | 100,000 | 11.2 |
| line-1m-static | 1,000,000 | 1,000,000 | 165.9 |
| line-1m-pan | 1,000,000 | 100,000 | 115.9 |
| line-1m-stream | 1,000,000 | 100,000 | 101.0 |
| line-10m-pan | 10,000,000 | 5,000,000 | 1776.7 |

## Initial chart ready time

Ready time includes library chart construction plus the first browser frame after shared scenario data has been prepared. Each displayed row follows the discarded setup warmup run(s) recorded in the environment section.

| Scenario | Library | Version | Ready ms | Heap after ready | First frame details |
|---|---|---:|---:|---:|---|
| line-100k-static | BlazePlot | 0.3.11 | 20.7 | 13.1 MiB | minmax, 4.50 ms render, 9,234 pts, 1 draws |
| line-100k-static | uPlot | 1.6.32 | **9.1** | 12.3 MiB | — |
| line-100k-static | Chart.js | 4.5.1 | 14.1 | 12.3 MiB | — |
| line-1m-static | BlazePlot | 0.3.11 | **21.6** | 64.1 MiB | minmax, 10.60 ms render, 9,288 pts, 1 draws |
| line-1m-static | uPlot | 1.6.32 | 28.8 | 76.2 MiB | — |
| line-1m-static | Chart.js | 4.5.1 | 30.9 | 62.4 MiB | — |
| line-1m-pan | BlazePlot | 0.3.11 | 13.4 | 74.6 MiB | minmax, 6.90 ms render, 9,234 pts, 1 draws |
| line-1m-pan | uPlot | 1.6.32 | **12.1** | 63.3 MiB | — |
| line-1m-pan | Chart.js | 4.5.1 | 16.5 | 62.6 MiB | — |
| line-1m-stream | BlazePlot | 0.3.11 | 42.1 | 75.4 MiB | minmax, 19.00 ms render, 9,234 pts, 1 draws |
| line-1m-stream | uPlot | 1.6.32 | 21.0 | 69.5 MiB | — |
| line-1m-stream | Chart.js | 4.5.1 | **20.2** | 63.1 MiB | — |
| line-10m-pan | BlazePlot | 0.3.11 | **52.6** | 585.5 MiB | minmax, 33.60 ms render, 9,288 pts, 1 draws |
| line-10m-pan | uPlot | 1.6.32 | 81.8 | 607.4 MiB | — |
| line-10m-pan | Chart.js | 4.5.1 | 115.2 | 579.3 MiB | — |

## Automated pan and streaming measurements

These rows are collected without user interaction after the command starts. RAF columns measure browser frame cadence. Work columns use BlazePlot internal chart frame time when available and otherwise the synchronous library update/redraw call.

| Scenario | Library | RAF FPS | RAF p95 ms | Work p50 ms | Work p95 ms | Points p50 | Draws p50 | Appended | Heap after measure |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| line-1m-pan | BlazePlot | 119.5 | **8.40** | **0.90** | **2.50** | 9,234 | 1 | 0 | 67.7 MiB |
| line-1m-pan | uPlot | **119.8** | **8.40** | 1.90 | 5.10 | — | — | 0 | 79.8 MiB |
| line-1m-pan | Chart.js | 116.2 | **8.40** | 3.50 | 8.30 | — | — | 0 | 77.0 MiB |
| line-1m-stream | BlazePlot | **119.8** | **8.40** | **0.90** | **2.50** | 9,234 | 1 | 183,877 | 76.6 MiB |
| line-1m-stream | uPlot | **119.8** | **8.40** | 2.00 | 6.10 | — | — | 183,988 | 82.3 MiB |
| line-1m-stream | Chart.js | 118.8 | **8.40** | 3.60 | 8.10 | — | — | 183,724 | 88.2 MiB |
| line-10m-pan | BlazePlot | **66.4** | **25.00** | **13.00** | **20.60** | 9,288 | 1 | 0 | 602.7 MiB |
| line-10m-pan | uPlot | 17.6 | 83.30 | 48.40 | 79.30 | — | — | 0 | 592.9 MiB |
| line-10m-pan | Chart.js | 15.3 | 74.90 | 61.40 | 77.00 | — | — | 0 | 583.5 MiB |

## BlazePlot vs uPlot runtime delta

Higher ratios favor BlazePlot. FPS ratio is BlazePlot RAF FPS divided by uPlot RAF FPS; work ratio is uPlot p95 work time divided by BlazePlot p95 work time.

| Scenario | FPS ratio | Work p95 ratio | BlazePlot FPS | uPlot FPS | BlazePlot work p95 | uPlot work p95 |
|---|---:|---:|---:|---:|---:|---:|
| line-1m-pan | 1.00× | 2.04× | 119.5 | 119.8 | 2.50 | 5.10 |
| line-1m-stream | 1.00× | 2.44× | 119.8 | 119.8 | 2.50 | 6.10 |
| line-10m-pan | 3.78× | 3.85× | 66.4 | 17.6 | 20.60 | 79.30 |

## Failures

No library runs failed.

