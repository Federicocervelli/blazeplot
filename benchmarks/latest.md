# Latest BlazePlot comparison benchmark

Generated: 2026-10-04T11:49:53.195Z
Command: `bun run bench:compare --chrome C:\Program Files\Thorium\Application\thorium.exe`
Publishable: yes

## Environment

- Machine: Ryzen 7 7800X3D / RX 9070 / Windows 11; AMD Ryzen 7 7800X3D 8-Core Processor           ; 16 logical CPUs; 15.2 GiB RAM
- OS: win32 10.0.26200 x64
- Browser: Chrome/138.0.7204.303
- Executable: thorium.exe
- GPU/WebGL: ANGLE (AMD, AMD Radeon RX 9070 (0x00007550) Direct3D11 vs_5_0 ps_5_0, D3D11)
- Canvas: 1280×720 CSS px; DPR 1
- Library prewarm: 87.5 ms before measured runs
- Setup warmup runs: 1 discarded run(s) before each measured library/scenario

## Scenario data preparation

| Scenario | Description | Samples | Visible samples | Data prep ms |
|---|---|---:|---:|---:|
| line-100k-static | 100k point line, initial render | 100,000 | 100,000 | 4.2 |
| line-1m-static | 1M point line, initial render | 1,000,000 | 1,000,000 | 52.3 |
| line-1m-pan | 1M point line, automated pan over 100k visible samples | 1,000,000 | 100,000 | 34.2 |
| line-1m-stream | 1M point line, live append while following latest 100k samples | 1,000,000 | 100,000 | 33.9 |
| line-10m-accelerated-pan | 10M point line, automated pan over 5M visible samples using BlazePlot's accelerated dataset path | 10,000,000 | 5,000,000 | 385.9 |

## Initial chart ready time

Ready time includes library chart construction plus the first browser frame after shared scenario data has been prepared. Each displayed row follows the discarded setup warmup run(s) recorded in the environment section.

| Scenario | Library | Version | Ready ms | Heap after ready | First frame details |
|---|---|---:|---:|---:|---|
| line-100k-static | BlazePlot | 1.0.0-rc.1 | 13.9 | 17.0 MiB | minmax, 6.60 ms render, 24,000 pts, 1 draws |
| line-100k-static | uPlot | 1.6.32 | 7.8 | 19.0 MiB | — |
| line-100k-static | Chart.js | 4.5.1 | **7.2** | 15.2 MiB | — |
| line-1m-static | BlazePlot | 1.0.0-rc.1 | 17.4 | 68.8 MiB | minmax, 10.50 ms render, 24,492 pts, 1 draws |
| line-1m-static | uPlot | 1.6.32 | **10.9** | 71.8 MiB | — |
| line-1m-static | Chart.js | 4.5.1 | 14.1 | 80.6 MiB | — |
| line-1m-pan | BlazePlot | 1.0.0-rc.1 | 15.3 | 67.8 MiB | minmax, 8.60 ms render, 24,000 pts, 1 draws |
| line-1m-pan | uPlot | 1.6.32 | **4.9** | 75.8 MiB | — |
| line-1m-pan | Chart.js | 4.5.1 | 6.5 | 70.7 MiB | — |
| line-1m-stream | BlazePlot | 1.0.0-rc.1 | 14.6 | 68.6 MiB | minmax, 3.60 ms render, 24,000 pts, 1 draws |
| line-1m-stream | uPlot | 1.6.32 | **5.6** | 84.9 MiB | — |
| line-1m-stream | Chart.js | 4.5.1 | 7.0 | 89.7 MiB | — |
| line-10m-accelerated-pan | BlazePlot | 1.0.0-rc.1 | **7.7** | 480.2 MiB | minmax, 2.50 ms render, 24,576 pts, 1 draws |
| line-10m-accelerated-pan | uPlot | 1.6.32 | 37.0 | 468.7 MiB | — |
| line-10m-accelerated-pan | Chart.js | 4.5.1 | 48.6 | 468.3 MiB | — |

## Automated pan and streaming measurements

These rows are collected without user interaction after the command starts. RAF columns measure browser frame cadence. Work columns use BlazePlot internal chart frame time when available and otherwise the synchronous library update/redraw call.

| Scenario | Library | RAF FPS | RAF p95 ms | Work p50 ms | Work p95 ms | Points p50 | Draws p50 | Appended | Heap after measure |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| line-1m-pan | BlazePlot | **144.0** | **7.00** | **0.80** | **1.00** | 24,006 | 1 | 0 | 75.8 MiB |
| line-1m-pan | uPlot | **144.0** | 7.20 | 1.40 | 1.90 | — | — | 0 | 70.7 MiB |
| line-1m-pan | Chart.js | 143.7 | 7.30 | 2.00 | 2.30 | — | — | 0 | 76.6 MiB |
| line-1m-stream | BlazePlot | **144.0** | **7.30** | **0.70** | **0.90** | 24,006 | 1 | 184,098 | 84.9 MiB |
| line-1m-stream | uPlot | **144.0** | **7.30** | 1.30 | 1.50 | — | — | 184,233 | 89.7 MiB |
| line-1m-stream | Chart.js | **144.0** | **7.30** | 2.00 | 2.20 | — | — | 184,012 | 112.4 MiB |
| line-10m-accelerated-pan | BlazePlot | **144.0** | **7.30** | **0.20** | **0.40** | 24,576 | 1 | 0 | 479.2 MiB |
| line-10m-accelerated-pan | uPlot | 33.4 | 34.90 | 29.80 | 30.60 | — | — | 0 | 473.5 MiB |
| line-10m-accelerated-pan | Chart.js | 30.1 | 35.10 | 32.80 | 33.40 | — | — | 0 | 490.1 MiB |

## BlazePlot vs uPlot runtime delta

Higher ratios favor BlazePlot. FPS ratio is BlazePlot RAF FPS divided by uPlot RAF FPS; work ratio is uPlot p95 work time divided by BlazePlot p95 work time.

| Scenario | FPS ratio | Work p95 ratio | BlazePlot FPS | uPlot FPS | BlazePlot work p95 | uPlot work p95 |
|---|---:|---:|---:|---:|---:|---:|
| line-1m-pan | 1.00× | 1.90× | 144.0 | 144.0 | 1.00 | 1.90 |
| line-1m-stream | 1.00× | 1.67× | 144.0 | 144.0 | 0.90 | 1.50 |
| line-10m-accelerated-pan | 4.32× | 76.50× | 144.0 | 33.4 | 0.40 | 30.60 |

## Failures

No library runs failed.

