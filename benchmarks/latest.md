# Latest BlazePlot comparison benchmark

Generated: 2026-10-05T10:17:49.928Z
Command: `bun run bench:compare --libraries blazeplot,blazeplot-canvas2d,uplot,chartjs`
Publishable: yes

## Environment

- Machine: local machine; AMD Ryzen 7 7800X3D 8-Core Processor           ; 16 logical CPUs; 15.2 GiB RAM
- OS: win32 10.0.26200 x64
- Browser: Chrome/153.0.8010.12
- Executable: chrome.exe
- GPU/WebGL: ANGLE (AMD, AMD Radeon RX 9070 (0x00007550) Direct3D11 vs_5_0 ps_5_0, D3D11)
- Canvas: 1280×720 CSS px; DPR 1
- Library prewarm: 164.1 ms before measured runs
- Setup warmup runs: 1 discarded run(s) before each measured library/scenario

## Scenario data preparation

| Scenario | Description | Samples | Visible samples | Data prep ms |
|---|---|---:|---:|---:|
| line-100k-static | 100k point line, initial render | 100,000 | 100,000 | 7.7 |
| line-1m-static | 1M point line, initial render | 1,000,000 | 1,000,000 | 80.0 |
| line-1m-pan | 1M point line, automated pan over 100k visible samples | 1,000,000 | 100,000 | 87.0 |
| line-1m-stream | 1M point line, live append while following latest 100k samples | 1,000,000 | 100,000 | 75.3 |
| line-10m-accelerated-pan | 10M point line, automated pan over 5M visible samples using BlazePlot's accelerated dataset path | 10,000,000 | 5,000,000 | 764.7 |

## Initial chart ready time

Ready time includes library chart construction plus the first browser frame after shared scenario data has been prepared. Each displayed row follows the discarded setup warmup run(s) recorded in the environment section.

| Scenario | Library | Version | Ready ms | Heap after ready | First frame details |
|---|---|---:|---:|---:|---|
| line-100k-static | BlazePlot | 1.0.0-rc.6 | 8.6 | 16.6 MiB | minmax, 5.20 ms render, 24,000 pts, 1 draws |
| line-100k-static | BlazePlot (Canvas 2D) | 1.0.0-rc.6 | 5.1 | 19.3 MiB | minmax, 3.90 ms render, 24,000 pts, 1 draws |
| line-100k-static | uPlot | 1.6.32 | **3.2** | 17.8 MiB | — |
| line-100k-static | Chart.js | 4.5.1 | 6.4 | 16.6 MiB | — |
| line-1m-static | BlazePlot | 1.0.0-rc.6 | 13.5 | 68.8 MiB | minmax, 9.50 ms render, 24,492 pts, 1 draws |
| line-1m-static | BlazePlot (Canvas 2D) | 1.0.0-rc.6 | **11.4** | 71.5 MiB | minmax, 9.00 ms render, 24,492 pts, 1 draws |
| line-1m-static | uPlot | 1.6.32 | 13.7 | 71.3 MiB | — |
| line-1m-static | Chart.js | 4.5.1 | 12.3 | 80.5 MiB | — |
| line-1m-pan | BlazePlot | 1.0.0-rc.6 | 11.1 | 79.4 MiB | minmax, 7.80 ms render, 24,000 pts, 1 draws |
| line-1m-pan | BlazePlot (Canvas 2D) | 1.0.0-rc.6 | 8.7 | 71.5 MiB | minmax, 7.20 ms render, 24,000 pts, 1 draws |
| line-1m-pan | uPlot | 1.6.32 | **2.9** | 80.0 MiB | — |
| line-1m-pan | Chart.js | 4.5.1 | 4.7 | 67.1 MiB | — |
| line-1m-stream | BlazePlot | 1.0.0-rc.6 | 13.4 | 115.2 MiB | minmax, 3.50 ms render, 24,000 pts, 1 draws |
| line-1m-stream | BlazePlot (Canvas 2D) | 1.0.0-rc.6 | 10.7 | 110.2 MiB | minmax, 3.00 ms render, 24,000 pts, 1 draws |
| line-1m-stream | uPlot | 1.6.32 | **3.3** | 127.5 MiB | — |
| line-1m-stream | Chart.js | 4.5.1 | 5.2 | 68.1 MiB | — |
| line-10m-accelerated-pan | BlazePlot | 1.0.0-rc.6 | 7.8 | 523.0 MiB | minmax, 3.70 ms render, 24,576 pts, 1 draws |
| line-10m-accelerated-pan | BlazePlot (Canvas 2D) | 1.0.0-rc.6 | **3.4** | 469.7 MiB | minmax, 2.10 ms render, 24,576 pts, 1 draws |
| line-10m-accelerated-pan | uPlot | 1.6.32 | 36.9 | 468.8 MiB | — |
| line-10m-accelerated-pan | Chart.js | 4.5.1 | 38.2 | 468.8 MiB | — |

## Automated pan and streaming measurements

These rows are collected without user interaction after the command starts. RAF columns measure browser frame cadence. Work columns use BlazePlot internal chart frame time when available and otherwise the synchronous library update/redraw call.

| Scenario | Library | RAF FPS | RAF p95 ms | Work p50 ms | Work p95 ms | Points p50 | Draws p50 | Appended | Heap after measure |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| line-1m-pan | BlazePlot | **1045.5** | **1.10** | **0.60** | **0.80** | 24,006 | 1 | 0 | 72.2 MiB |
| line-1m-pan | BlazePlot (Canvas 2D) | 683.3 | 1.70 | 1.00 | 1.20 | 24,006 | 1 | 0 | 80.0 MiB |
| line-1m-pan | uPlot | 775.1 | 1.50 | 1.10 | 1.30 | — | — | 0 | 91.9 MiB |
| line-1m-pan | Chart.js | 513.8 | 2.20 | 1.80 | 2.10 | — | — | 0 | 75.1 MiB |
| line-1m-stream | BlazePlot | **1087.6** | **1.10** | **0.60** | **0.70** | 24,006 | 1 | 184,307 | 135.4 MiB |
| line-1m-stream | BlazePlot (Canvas 2D) | 690.0 | 1.70 | 1.00 | 1.20 | 24,006 | 1 | 184,313 | 127.5 MiB |
| line-1m-stream | uPlot | 769.9 | 1.50 | 1.10 | 1.30 | — | — | 184,264 | 87.7 MiB |
| line-1m-stream | Chart.js | 514.5 | 2.20 | 1.80 | 2.00 | — | — | 184,289 | 88.3 MiB |
| line-10m-accelerated-pan | BlazePlot | **1987.1** | **0.60** | **0.20** | **0.30** | 24,576 | 1 | 0 | 537.2 MiB |
| line-10m-accelerated-pan | BlazePlot (Canvas 2D) | 973.6 | 1.40 | 0.50 | 0.70 | 24,576 | 1 | 0 | 494.1 MiB |
| line-10m-accelerated-pan | uPlot | 31.6 | 33.60 | 31.90 | 32.90 | — | — | 0 | 477.7 MiB |
| line-10m-accelerated-pan | Chart.js | 29.6 | 50.20 | 33.70 | 34.50 | — | — | 0 | 495.2 MiB |

## BlazePlot vs uPlot runtime delta

Higher ratios favor BlazePlot. FPS ratio is BlazePlot RAF FPS divided by uPlot RAF FPS; work ratio is uPlot p95 work time divided by BlazePlot p95 work time.

| Scenario | FPS ratio | Work p95 ratio | BlazePlot FPS | uPlot FPS | BlazePlot work p95 | uPlot work p95 |
|---|---:|---:|---:|---:|---:|---:|
| line-1m-pan | 1.35× | 1.63× | 1045.5 | 775.1 | 0.80 | 1.30 |
| line-1m-stream | 1.41× | 1.86× | 1087.6 | 769.9 | 0.70 | 1.30 |
| line-10m-accelerated-pan | 62.97× | 109.67× | 1987.1 | 31.6 | 0.30 | 32.90 |

## Failures

No library runs failed.

