# Latest BlazePlot comparison benchmark

Generated: 2026-10-05T13:42:39.583Z
Command: `bun run bench:compare --port 41821 --debug-port 9401`
Publishable: yes

## Environment

- Machine: local machine; AMD Ryzen 7 7800X3D 8-Core Processor; 16 logical CPUs; 15.2 GiB RAM
- OS: win32 10.0.26200 x64
- Browser: Chrome/153.0.8010.12 (chrome.exe)
- GPU/WebGL: ANGLE (AMD, AMD Radeon RX 9070 (0x00007550) Direct3D11 vs_5_0 ps_5_0, D3D11)
- Canvas: 1280×720 CSS px; DPR 1
- Runs: 7 fresh-page runs per scenario and library (median reported); 1 discarded full-size setup run(s) per page
- Libraries: BlazePlot 1.0.0-rc.8; BlazePlot (Canvas 2D) 1.0.0-rc.8; uPlot 1.6.32; Chart.js 4.5.1

## Scoreboard

Primary metric of each scenario (median over runs). Advantage columns are > 1.00× when BlazePlot (WebGL) is better, whatever the metric direction. Every metric is in [Results by scenario](#results-by-scenario).

| Scenario | Metric | BlazePlot | BlazePlot (Canvas 2D) | uPlot | Chart.js | Winner | BlazePlot vs uPlot | BlazePlot vs Chart.js |
|---|---|---:|---:|---:|---:|---|---:|---:|
| line-100k-static | Ready (ms) | 6.50 | 4.21 | 3.22 | 3.68 | tie (uPlot, Chart.js) | 0.50× | 0.57× |
| line-1m-static | Ready (ms) | 9.78 | 7.86 | 10.44 | 16.02 | tie (BlazePlot, uPlot, Chart.js) | 1.07× | 1.64× |
| cold-first-chart | Ready (ms) | 15.53 | 13.04 | **10.31** | 18.45 | uPlot | 0.66× | 1.19× |
| line-1m-pan | FPS (fps, higher is better) | **1008** | 630 | 694 | 521 | BlazePlot | 1.45× | 1.93× |
| line-1m-stream | FPS (fps, higher is better) | **999** | 630 | 690 | 504 | BlazePlot | 1.45× | 1.98× |
| line-10m-accelerated-pan | FPS (fps, higher is better) | **1904** | 934 | 26.0 | 23.8 | BlazePlot | 73.2× | 80.1× |
| multi-10x100k-pan | FPS (fps, higher is better) | **235** | 98.3 | 137 | 110 | BlazePlot | 1.72× | 2.14× |
| multi-100x20k-pan | FPS (fps, higher is better) | **132** | 13.0 | 30.4 | 18.5 | BlazePlot | 4.36× | 7.16× |
| area-1m-pan | FPS (fps, higher is better) | **1296** | 886 | 676 | 464 | BlazePlot | 1.92× | 2.80× |
| scatter-1m-pan | FPS (fps, higher is better) | **1489** | 283 | 34.8 | 3.1 | BlazePlot | 42.8× | 478.9× |
| bar-100k-pan | FPS (fps, higher is better) | **1785** | 473 | 768 | 3.9 | BlazePlot | 2.33× | 460.0× |
| dual-axis-1m-pan | FPS (fps, higher is better) | **621** | 358 | 373 | 296 | BlazePlot | 1.66× | 2.09× |
| hover-1m | Hover p50 (ms) | 0.45 | 0.45 | **0.22** | 0.34 | uPlot | 0.49× | 0.76× |
| resize-1m | Resize p50 (ms) | **37.55** | 37.08 | 43.06 | 43.54 | BlazePlot | 1.15× | 1.16× |
| many-charts-50 | Ready (ms) | 40.16 | 46.91 | **21.02** | 47.62 | uPlot | 0.52× | 1.19× |
| mount-destroy-cycle | Cycle p50 (ms) | 4.70 | 2.48 | **1.67** | 2.18 | uPlot | 0.36× | 0.46× |
| heap-soak-1m-pan | Heap growth (MiB) | 0.4 | 0.3 | 0.2 | 0.4 | tie (uPlot, BlazePlot) | 0.45× | 1.11× |
| stream-throughput | Max rate (k samples/s, higher is better) | 102400 | 102400 | 51200 | 3200 | tie (BlazePlot, uPlot) | 2.00× | 32.0× |

## Where BlazePlot does not win

Every metric of every scenario where BlazePlot (WebGL) is not clearly ahead of uPlot or Chart.js. Advantage is competitor ÷ BlazePlot for lower-is-better metrics and BlazePlot ÷ competitor for higher-is-better ones, so values below 1.00× are losses. "Within noise" means the medians differ by less than the noise floor or the min–max ranges of the runs overlap.

| Scenario | Metric | BlazePlot | Competitor | Competitor value | Advantage | Verdict |
|---|---|---:|---|---:|---:|---|
| line-100k-static | Ready (ms) | 6.50 | uPlot | 3.22 | 0.50× | LOSS |
| line-100k-static | Ready (ms) | 6.50 | Chart.js | 3.68 | 0.57× | LOSS |
| line-100k-static | Construct (ms) | 2.46 | uPlot | 0.20 | 0.08× | LOSS |
| line-100k-static | Heap (MiB) | 1.9 | uPlot | 1.6 | 0.83× | LOSS |
| line-1m-static | Construct (ms) | 2.82 | uPlot | 0.21 | 0.07× | LOSS |
| cold-first-chart | Ready (ms) | 15.53 | uPlot | 10.31 | 0.66× | LOSS |
| cold-first-chart | Construct (ms) | 6.30 | uPlot | 1.81 | 0.29× | LOSS |
| line-1m-pan | Ready (ms) | 9.70 | uPlot | 3.01 | 0.31× | LOSS |
| line-1m-pan | Ready (ms) | 9.70 | Chart.js | 5.98 | 0.62× | LOSS |
| line-1m-stream | Ready (ms) | 10.14 | uPlot | 2.88 | 0.28× | LOSS |
| line-1m-stream | Ready (ms) | 10.14 | Chart.js | 5.83 | 0.57× | LOSS |
| multi-10x100k-pan | Ready (ms) | 13.38 | uPlot | 8.14 | 0.61× | LOSS |
| multi-10x100k-pan | Ready (ms) | 13.38 | Chart.js | 11.84 | 0.89× | LOSS |
| area-1m-pan | Ready (ms) | 9.62 | uPlot | 2.97 | 0.31× | LOSS |
| area-1m-pan | Ready (ms) | 9.62 | Chart.js | 7.63 | 0.79× | LOSS |
| bar-100k-pan | Ready (ms) | 4.55 | uPlot | 3.03 | 0.67× | LOSS |
| dual-axis-1m-pan | Ready (ms) | 10.02 | uPlot | 3.55 | 0.35× | LOSS |
| dual-axis-1m-pan | Ready (ms) | 10.02 | Chart.js | 5.84 | 0.58× | LOSS |
| hover-1m | Hover p50 (ms) | 0.45 | uPlot | 0.22 | 0.49× | LOSS |
| hover-1m | Hover p50 (ms) | 0.45 | Chart.js | 0.34 | 0.76× | LOSS |
| hover-1m | Hover p95 (ms) | 0.51 | uPlot | 0.26 | 0.51× | LOSS |
| many-charts-50 | Ready (ms) | 40.16 | uPlot | 21.02 | 0.52× | LOSS |
| many-charts-50 | Heap (MiB) | 42.9 | uPlot | 9.5 | 0.22× | LOSS |
| many-charts-50 | Heap (MiB) | 42.9 | Chart.js | 37.5 | 0.87× | LOSS |
| many-charts-50 | Destroy (ms) | 1.26 | uPlot | 0.20 | 0.15× | LOSS |
| many-charts-50 | Destroy (ms) | 1.26 | Chart.js | 0.47 | 0.37× | LOSS |
| mount-destroy-cycle | Cycle p50 (ms) | 4.70 | uPlot | 1.67 | 0.36× | LOSS |
| mount-destroy-cycle | Cycle p50 (ms) | 4.70 | Chart.js | 2.18 | 0.46× | LOSS |
| mount-destroy-cycle | Cycle p95 (ms) | 5.95 | uPlot | 2.44 | 0.41× | LOSS |
| mount-destroy-cycle | Cycle p95 (ms) | 5.95 | Chart.js | 4.45 | 0.75× | LOSS |
| mount-destroy-cycle | Retained (MiB) | 1.0 | uPlot | 0.3 | 0.26× | LOSS |
| line-1m-static | Ready (ms) | 9.78 | uPlot | 10.44 | 1.07× | within noise (leans BlazePlot) |
| line-1m-static | Ready (ms) | 9.78 | Chart.js | 16.02 | 1.64× | within noise (leans BlazePlot) |
| line-1m-stream | Heap (MiB) | 14.8 | uPlot | 15.5 | 1.04× | within noise (leans BlazePlot) |
| multi-100x20k-pan | Heap (MiB) | 16.3 | uPlot | 15.6 | 0.96× | within noise (leans uPlot) |
| bar-100k-pan | Heap (MiB) | 1.8 | uPlot | 1.6 | 0.87× | within noise (leans uPlot) |
| hover-1m | Hover p95 (ms) | 0.51 | Chart.js | 0.46 | 0.90× | within noise (leans Chart.js) |
| mount-destroy-cycle | Retained (MiB) | 1.0 | Chart.js | 0.9 | 0.93× | within noise (leans Chart.js) |
| heap-soak-1m-pan | Heap growth (MiB) | 0.4 | uPlot | 0.2 | 0.45× | within noise (leans uPlot) |
| heap-soak-1m-pan | Heap growth (MiB) | 0.4 | Chart.js | 0.4 | 1.11× | within noise (leans BlazePlot) |
| stream-throughput | Max rate (k samples/s) | 102400 | uPlot | 51200 | 2.00× | within noise (leans BlazePlot) |

### Canvas 2D backend versus uPlot

The Canvas 2D backend is the fallback renderer; the same rule applied against uPlot only.

| Scenario | Metric | BlazePlot (Canvas 2D) | Competitor | Competitor value | Advantage | Verdict |
|---|---|---:|---|---:|---:|---|
| line-100k-static | Construct (ms) | 0.48 | uPlot | 0.20 | 0.41× | LOSS |
| line-1m-static | Construct (ms) | 1.28 | uPlot | 0.21 | 0.16× | LOSS |
| cold-first-chart | Ready (ms) | 13.04 | uPlot | 10.31 | 0.79× | LOSS |
| cold-first-chart | Construct (ms) | 3.32 | uPlot | 1.81 | 0.55× | LOSS |
| line-1m-pan | FPS (fps) | 630 | uPlot | 694 | 0.91× | LOSS |
| line-1m-pan | Frame p95 (ms) | 1.85 | uPlot | 1.75 | 0.94× | LOSS |
| line-1m-pan | Ready (ms) | 7.78 | uPlot | 3.01 | 0.39× | LOSS |
| line-1m-stream | FPS (fps) | 630 | uPlot | 690 | 0.91× | LOSS |
| line-1m-stream | Ready (ms) | 8.56 | uPlot | 2.88 | 0.34× | LOSS |
| multi-10x100k-pan | FPS (fps) | 98.3 | uPlot | 137 | 0.72× | LOSS |
| multi-10x100k-pan | Frame p95 (ms) | 12.43 | uPlot | 9.20 | 0.74× | LOSS |
| multi-10x100k-pan | Work p50 (ms) | 7.91 | uPlot | 6.67 | 0.84× | LOSS |
| multi-10x100k-pan | Work p95 (ms) | 10.14 | uPlot | 8.85 | 0.87× | LOSS |
| multi-10x100k-pan | Ready (ms) | 16.50 | uPlot | 8.14 | 0.49× | LOSS |
| multi-100x20k-pan | FPS (fps) | 13.0 | uPlot | 30.4 | 0.43× | LOSS |
| multi-100x20k-pan | Frame p95 (ms) | 144.1 | uPlot | 46.07 | 0.32× | LOSS |
| area-1m-pan | Ready (ms) | 7.12 | uPlot | 2.97 | 0.42× | LOSS |
| bar-100k-pan | FPS (fps) | 473 | uPlot | 768 | 0.62× | LOSS |
| bar-100k-pan | Frame p95 (ms) | 2.81 | uPlot | 1.66 | 0.59× | LOSS |
| bar-100k-pan | Work p50 (ms) | 1.27 | uPlot | 1.07 | 0.84× | LOSS |
| bar-100k-pan | Work p95 (ms) | 1.72 | uPlot | 1.46 | 0.85× | LOSS |
| bar-100k-pan | Ready (ms) | 3.71 | uPlot | 3.03 | 0.82× | LOSS |
| dual-axis-1m-pan | Ready (ms) | 8.81 | uPlot | 3.55 | 0.40× | LOSS |
| hover-1m | Hover p50 (ms) | 0.45 | uPlot | 0.22 | 0.49× | LOSS |
| hover-1m | Hover p95 (ms) | 0.51 | uPlot | 0.26 | 0.51× | LOSS |
| many-charts-50 | Ready (ms) | 46.91 | uPlot | 21.02 | 0.45× | LOSS |
| many-charts-50 | Heap (MiB) | 42.7 | uPlot | 9.5 | 0.22× | LOSS |
| many-charts-50 | Destroy (ms) | 0.73 | uPlot | 0.20 | 0.27× | LOSS |
| mount-destroy-cycle | Cycle p50 (ms) | 2.48 | uPlot | 1.67 | 0.67× | LOSS |
| mount-destroy-cycle | Cycle p95 (ms) | 4.00 | uPlot | 2.44 | 0.61× | LOSS |
| mount-destroy-cycle | Retained (MiB) | 0.7 | uPlot | 0.3 | 0.35× | LOSS |
| heap-soak-1m-pan | FPS (fps) | 607 | uPlot | 677 | 0.90× | LOSS |
| line-100k-static | Ready (ms) | 4.21 | uPlot | 3.22 | 0.76× | within noise (leans uPlot) |
| line-100k-static | Heap (MiB) | 1.7 | uPlot | 1.6 | 0.95× | within noise (leans uPlot) |
| line-1m-stream | Frame p95 (ms) | 1.83 | uPlot | 1.91 | 1.04× | within noise (leans BlazePlot (Canvas 2D)) |
| bar-100k-pan | Heap (MiB) | 1.6 | uPlot | 1.6 | 1.00× | within noise (leans BlazePlot (Canvas 2D)) |
| dual-axis-1m-pan | FPS (fps) | 358 | uPlot | 373 | 0.96× | within noise (leans uPlot) |
| dual-axis-1m-pan | Frame p95 (ms) | 3.23 | uPlot | 3.26 | 1.01× | within noise (leans BlazePlot (Canvas 2D)) |
| heap-soak-1m-pan | Heap growth (MiB) | 0.3 | uPlot | 0.2 | 0.58× | within noise (leans uPlot) |
| stream-throughput | Max rate (k samples/s) | 102400 | uPlot | 51200 | 2.00× | within noise (leans BlazePlot (Canvas 2D)) |

## Results by scenario

Each cell is median · p95 across runs · half-range spread as a percentage of the median. Bold marks the winner among BlazePlot (WebGL), uPlot and Chart.js.

### Setup

#### line-100k-static

100k point line, initial render

| Metric | BlazePlot | BlazePlot (Canvas 2D) | uPlot | Chart.js | Winner | BlazePlot vs uPlot | BlazePlot vs Chart.js |
|---|---:|---:|---:|---:|---|---:|---:|
| Ready (ms) | 6.50 · p95 6.98 · ±7% | 4.21 · p95 4.93 · ±11% | 3.22 · p95 4.96 · ±29% | 3.68 · p95 4.11 · ±9% | tie (uPlot, Chart.js) | 0.50× | 0.57× |
| Construct (ms) | 2.46 · p95 2.88 · ±10% | 0.48 · p95 0.64 · ±18% | **0.20** · p95 0.23 · ±14% | 3.24 · p95 3.69 · ±10% | uPlot | 0.08× | 1.32× |
| Heap (MiB) | 1.9 · p95 1.9 · ±0% | 1.7 · p95 1.7 · ±0% | **1.6** · p95 1.6 · ±0% | 4.1 · p95 4.1 · ±0% | uPlot | 0.83× | 2.13× |

#### line-1m-static

1M point line, initial render

| Metric | BlazePlot | BlazePlot (Canvas 2D) | uPlot | Chart.js | Winner | BlazePlot vs uPlot | BlazePlot vs Chart.js |
|---|---:|---:|---:|---:|---|---:|---:|
| Ready (ms) | 9.78 · p95 14.88 · ±28% | 7.86 · p95 8.38 · ±5% | 10.44 · p95 11.07 · ±4% | 16.02 · p95 16.79 · ±6% | tie (BlazePlot, uPlot, Chart.js) | 1.07× | 1.64× |
| Construct (ms) | 2.82 · p95 3.15 · ±7% | 1.28 · p95 1.41 · ±9% | **0.21** · p95 0.25 · ±13% | 15.47 · p95 16.41 · ±7% | uPlot | 0.07× | 5.49× |
| Heap (MiB) | **12.6** · p95 12.6 · ±0% | 12.4 · p95 12.4 · ±0% | 15.3 · p95 15.3 · ±0% | 35.0 · p95 35.0 · ±0% | BlazePlot | 1.21× | 2.77× |

#### cold-first-chart

100k point line, first chart on a cold page (no prewarm, no warmup run)

| Metric | BlazePlot | BlazePlot (Canvas 2D) | uPlot | Chart.js | Winner | BlazePlot vs uPlot | BlazePlot vs Chart.js |
|---|---:|---:|---:|---:|---|---:|---:|
| Ready (ms) | 15.53 · p95 15.73 · ±3% | 13.04 · p95 13.60 · ±4% | **10.31** · p95 10.52 · ±3% | 18.45 · p95 18.77 · ±2% | uPlot | 0.66× | 1.19× |
| Construct (ms) | 6.30 · p95 6.50 · ±5% | 3.32 · p95 3.44 · ±5% | **1.81** · p95 2.27 · ±14% | 17.30 · p95 17.63 · ±2% | uPlot | 0.29× | 2.74× |

### Line

#### line-1m-pan

1M point line, automated pan over 100k visible samples

| Metric | BlazePlot | BlazePlot (Canvas 2D) | uPlot | Chart.js | Winner | BlazePlot vs uPlot | BlazePlot vs Chart.js |
|---|---:|---:|---:|---:|---|---:|---:|
| FPS (fps) | **1008** · p95 1014 · ±1% | 630 · p95 635 · ±1% | 694 · p95 697 · ±1% | 521 · p95 527 · ±1% | BlazePlot | 1.45× | 1.93× |
| Frame p95 (ms) | **1.15** · p95 1.18 · ±2% | 1.85 · p95 1.91 · ±2% | 1.75 · p95 1.76 · ±2% | 2.33 · p95 2.45 · ±4% | BlazePlot | 1.53× | 2.03× |
| Work p50 (ms) | **0.61** · p95 0.61 · ±1% | 1.06 · p95 1.08 · ±2% | 1.24 · p95 1.26 · ±1% | 1.73 · p95 1.75 · ±2% | BlazePlot | 2.03× | 2.84× |
| Work p95 (ms) | **0.74** · p95 0.74 · ±1% | 1.31 · p95 1.32 · ±2% | 1.53 · p95 1.55 · ±1% | 2.13 · p95 2.23 · ±3% | BlazePlot | 2.07× | 2.89× |
| Ready (ms) | 9.70 · p95 15.09 · ±31% | 7.78 · p95 13.69 · ±39% | **3.01** · p95 3.42 · ±9% | 5.98 · p95 6.71 · ±6% | uPlot | 0.31× | 0.62× |
| Heap (MiB) | **12.6** · p95 12.6 · ±0% | 12.4 · p95 12.4 · ±0% | 15.3 · p95 15.3 · ±0% | 35.0 · p95 35.0 · ±0% | BlazePlot | 1.21× | 2.77× |

#### line-1m-stream

1M point line, live append while following latest 100k samples

| Metric | BlazePlot | BlazePlot (Canvas 2D) | uPlot | Chart.js | Winner | BlazePlot vs uPlot | BlazePlot vs Chart.js |
|---|---:|---:|---:|---:|---|---:|---:|
| FPS (fps) | **999** · p95 1029 · ±4% | 630 · p95 639 · ±3% | 690 · p95 706 · ±4% | 504 · p95 512 · ±3% | BlazePlot | 1.45× | 1.98× |
| Frame p95 (ms) | **1.15** · p95 1.24 · ±5% | 1.83 · p95 1.98 · ±5% | 1.91 · p95 2.04 · ±9% | 2.40 · p95 2.64 · ±6% | BlazePlot | 1.66× | 2.09× |
| Work p50 (ms) | **0.61** · p95 0.67 · ±6% | 1.07 · p95 1.16 · ±6% | 1.20 · p95 1.27 · ±5% | 1.79 · p95 1.84 · ±2% | BlazePlot | 1.97× | 2.94× |
| Work p95 (ms) | **0.74** · p95 0.80 · ±5% | 1.28 · p95 1.39 · ±5% | 1.67 · p95 1.80 · ±9% | 2.19 · p95 2.43 · ±7% | BlazePlot | 2.25× | 2.97× |
| Ready (ms) | 10.14 · p95 15.06 · ±26% | 8.56 · p95 13.18 · ±31% | **2.88** · p95 3.13 · ±6% | 5.83 · p95 7.32 · ±31% | uPlot | 0.28× | 0.57× |
| Heap (MiB) | 14.8 · p95 14.8 · ±0% | 14.6 · p95 14.6 · ±0% | 15.5 · p95 15.5 · ±0% | 39.0 · p95 39.0 · ±0% | tie (BlazePlot, uPlot) | 1.04× | 2.63× |

#### line-10m-accelerated-pan

10M point line, pan over 5M visible samples (BlazePlot uses its accelerated dataset path)

| Metric | BlazePlot | BlazePlot (Canvas 2D) | uPlot | Chart.js | Winner | BlazePlot vs uPlot | BlazePlot vs Chart.js |
|---|---:|---:|---:|---:|---|---:|---:|
| FPS (fps) | **1904** · p95 1917 · ±0% | 934 · p95 954 · ±2% | 26.0 · p95 28.6 · ±7% | 23.8 · p95 25.2 · ±6% | BlazePlot | 73.2× | 80.1× |
| Frame p95 (ms) | **0.65** · p95 0.66 · ±1% | 1.36 · p95 1.39 · ±2% | 57.62 · p95 68.08 · ±16% | 51.09 · p95 67.63 · ±18% | BlazePlot | 89.3× | 79.2× |
| Work p50 (ms) | **0.16** · p95 0.16 · ±2% | 0.54 · p95 0.56 · ±2% | 33.61 · p95 34.08 · ±4% | 41.95 · p95 48.14 · ±14% | BlazePlot | 210.1× | 262.2× |
| Work p95 (ms) | **0.24** · p95 0.25 · ±2% | 0.79 · p95 0.83 · ±5% | 55.27 · p95 56.45 · ±8% | 50.44 · p95 53.78 · ±6% | BlazePlot | 225.6× | 205.9× |
| Ready (ms) | **5.09** · p95 5.41 · ±14% | 2.63 · p95 2.91 · ±11% | 30.59 · p95 31.08 · ±1% | 42.58 · p95 42.79 · ±2% | BlazePlot | 6.01× | 8.36× |
| Heap (MiB) | **0.7** · p95 0.7 · ±0% | 0.4 · p95 0.4 · ±0% | 152.6 · p95 152.6 · ±0% | 344.0 · p95 344.0 · ±0% | BlazePlot | 224.5× | 505.9× |

### Series types

#### multi-10x100k-pan

10 line series of 100k samples, pan over 50k visible samples

| Metric | BlazePlot | BlazePlot (Canvas 2D) | uPlot | Chart.js | Winner | BlazePlot vs uPlot | BlazePlot vs Chart.js |
|---|---:|---:|---:|---:|---|---:|---:|
| FPS (fps) | **235** · p95 238 · ±1% | 98.3 · p95 101 · ±2% | 137 · p95 140 · ±1% | 110 · p95 112 · ±3% | BlazePlot | 1.72× | 2.14× |
| Frame p95 (ms) | **4.75** · p95 4.80 · ±1% | 12.43 · p95 12.87 · ±4% | 9.20 · p95 9.36 · ±2% | 12.06 · p95 12.18 · ±3% | BlazePlot | 1.94× | 2.54× |
| Work p50 (ms) | **3.74** · p95 3.77 · ±1% | 7.91 · p95 7.95 · ±1% | 6.67 · p95 6.72 · ±1% | 8.02 · p95 8.46 · ±3% | BlazePlot | 1.78× | 2.14× |
| Work p95 (ms) | **4.26** · p95 4.30 · ±1% | 10.14 · p95 10.39 · ±3% | 8.85 · p95 9.02 · ±2% | 11.73 · p95 11.87 · ±3% | BlazePlot | 2.08× | 2.75× |
| Ready (ms) | 13.38 · p95 13.65 · ±2% | 16.50 · p95 17.35 · ±3% | **8.14** · p95 10.99 · ±20% | 11.84 · p95 12.15 · ±2% | uPlot | 0.61× | 0.89× |
| Heap (MiB) | **7.7** · p95 7.7 · ±1% | 5.7 · p95 5.7 · ±0% | 8.5 · p95 8.5 · ±0% | 38.9 · p95 38.9 · ±0% | BlazePlot | 1.10× | 5.05× |

#### multi-100x20k-pan

100 line series of 20k samples, pan over 10k visible samples

| Metric | BlazePlot | BlazePlot (Canvas 2D) | uPlot | Chart.js | Winner | BlazePlot vs uPlot | BlazePlot vs Chart.js |
|---|---:|---:|---:|---:|---|---:|---:|
| FPS (fps) | **132** · p95 142 · ±5% | 13.0 · p95 19.1 · ±29% | 30.4 · p95 31.9 · ±6% | 18.5 · p95 19.1 · ±3% | BlazePlot | 4.36× | 7.16× |
| Frame p95 (ms) | **11.06** · p95 12.71 · ±13% | 144.1 · p95 188.1 · ±32% | 46.07 · p95 50.09 · ±8% | 78.12 · p95 79.97 · ±4% | BlazePlot | 4.16× | 7.06× |
| Work p50 (ms) | **6.21** · p95 6.39 · ±2% | 19.80 · p95 20.77 · ±6% | 29.91 · p95 34.57 · ±9% | 48.58 · p95 49.91 · ±3% | BlazePlot | 4.82× | 7.82× |
| Work p95 (ms) | **10.71** · p95 12.43 · ±13% | 30.75 · p95 34.67 · ±12% | 40.35 · p95 42.09 · ±6% | 71.47 · p95 73.41 · ±4% | BlazePlot | 3.77× | 6.67× |
| Ready (ms) | **17.88** · p95 18.23 · ±2% | 25.96 · p95 30.54 · ±11% | 36.24 · p95 40.13 · ±7% | 66.69 · p95 68.46 · ±3% | BlazePlot | 2.03× | 3.73× |
| Heap (MiB) | 16.3 · p95 16.3 · ±0% | 8.4 · p95 8.4 · ±0% | 15.6 · p95 15.6 · ±0% | 107.4 · p95 107.4 · ±0% | tie (uPlot, BlazePlot) | 0.96× | 6.57× |

#### area-1m-pan

1M point area (filled line), pan over 100k visible samples

| Metric | BlazePlot | BlazePlot (Canvas 2D) | uPlot | Chart.js | Winner | BlazePlot vs uPlot | BlazePlot vs Chart.js |
|---|---:|---:|---:|---:|---|---:|---:|
| FPS (fps) | **1296** · p95 1311 · ±3% | 886 · p95 892 · ±3% | 676 · p95 688 · ±4% | 464 · p95 476 · ±4% | BlazePlot | 1.92× | 2.80× |
| Frame p95 (ms) | **0.91** · p95 0.97 · ±5% | 1.36 · p95 1.46 · ±5% | 1.79 · p95 2.05 · ±9% | 2.66 · p95 2.95 · ±8% | BlazePlot | 1.98× | 2.94× |
| Work p50 (ms) | **0.41** · p95 0.44 · ±4% | 0.65 · p95 0.70 · ±5% | 1.26 · p95 1.32 · ±3% | 1.95 · p95 2.00 · ±2% | BlazePlot | 3.05× | 4.70× |
| Work p95 (ms) | **0.50** · p95 0.53 · ±4% | 0.85 · p95 0.92 · ±6% | 1.57 · p95 1.81 · ±9% | 2.47 · p95 2.72 · ±8% | BlazePlot | 3.15× | 4.94× |
| Ready (ms) | 9.62 · p95 17.13 · ±43% | 7.12 · p95 12.24 · ±38% | **2.97** · p95 3.22 · ±6% | 7.63 · p95 8.13 · ±17% | uPlot | 0.31× | 0.79× |
| Heap (MiB) | **12.6** · p95 12.6 · ±0% | 12.4 · p95 12.4 · ±0% | 15.3 · p95 15.3 · ±0% | 35.0 · p95 35.0 · ±0% | BlazePlot | 1.21× | 2.77× |

#### scatter-1m-pan

1M point scatter, pan over 100k visible samples

| Metric | BlazePlot | BlazePlot (Canvas 2D) | uPlot | Chart.js | Winner | BlazePlot vs uPlot | BlazePlot vs Chart.js |
|---|---:|---:|---:|---:|---|---:|---:|
| FPS (fps) | **1489** · p95 1557 · ±3% | 283 · p95 298 · ±4% | 34.8 · p95 35.1 · ±2% | 3.1 · p95 3.4 · ±7% | BlazePlot | 42.8× | 478.9× |
| Frame p95 (ms) | **0.84** · p95 0.86 · ±4% | 4.79 · p95 4.93 · ±10% | 48.06 · p95 50.04 · ±16% | 387.3 · p95 428.7 · ±9% | BlazePlot | 56.9× | 458.3× |
| Work p50 (ms) | **0.28** · p95 0.29 · ±5% | 2.89 · p95 2.94 · ±2% | 26.55 · p95 26.88 · ±1% | 316.2 · p95 341.6 · ±7% | BlazePlot | 94.8× | 1129.2× |
| Work p95 (ms) | **0.42** · p95 0.43 · ±5% | 4.29 · p95 4.43 · ±10% | 35.17 · p95 36.81 · ±6% | 379.2 · p95 435.9 · ±12% | BlazePlot | 83.8× | 902.8× |
| Ready (ms) | **8.52** · p95 14.18 · ±35% | 9.33 · p95 15.02 · ±34% | 29.69 · p95 31.30 · ±4% | 312.2 · p95 318.9 · ±3% | BlazePlot | 3.48× | 36.6× |
| Heap (MiB) | **12.6** · p95 12.6 · ±0% | 12.4 · p95 12.4 · ±0% | 15.3 · p95 15.3 · ±0% | 171.9 · p95 172.0 · ±0% | BlazePlot | 1.21× | 13.6× |

#### bar-100k-pan

100k bars, pan over 10k visible bars

| Metric | BlazePlot | BlazePlot (Canvas 2D) | uPlot | Chart.js | Winner | BlazePlot vs uPlot | BlazePlot vs Chart.js |
|---|---:|---:|---:|---:|---|---:|---:|
| FPS (fps) | **1785** · p95 1821 · ±2% | 473 · p95 477 · ±2% | 768 · p95 782 · ±3% | 3.9 · p95 4.0 · ±5% | BlazePlot | 2.33× | 460.0× |
| Frame p95 (ms) | **0.70** · p95 0.70 · ±1% | 2.81 · p95 3.05 · ±6% | 1.66 · p95 1.80 · ±5% | 329.4 · p95 436.8 · ±20% | BlazePlot | 2.37× | 470.6× |
| Work p50 (ms) | **0.17** · p95 0.19 · ±4% | 1.27 · p95 1.43 · ±7% | 1.07 · p95 1.14 · ±4% | 242.7 · p95 271.7 · ±9% | BlazePlot | 6.11× | 1386.6× |
| Work p95 (ms) | **0.28** · p95 0.29 · ±2% | 1.72 · p95 1.78 · ±2% | 1.46 · p95 1.58 · ±6% | 316.6 · p95 419.9 · ±22% | BlazePlot | 5.11× | 1110.7× |
| Ready (ms) | 4.55 · p95 5.00 · ±8% | 3.71 · p95 3.87 · ±6% | **3.03** · p95 3.23 · ±6% | 231.1 · p95 247.6 · ±5% | uPlot | 0.67× | 50.7× |
| Heap (MiB) | 1.8 · p95 1.8 · ±0% | 1.6 · p95 1.6 · ±0% | 1.6 · p95 1.6 · ±0% | 19.8 · p95 19.8 · ±0% | tie (uPlot, BlazePlot) | 0.87× | 10.8× |

#### dual-axis-1m-pan

Two 500k point lines on left and right Y axes, pan over 100k visible samples

| Metric | BlazePlot | BlazePlot (Canvas 2D) | uPlot | Chart.js | Winner | BlazePlot vs uPlot | BlazePlot vs Chart.js |
|---|---:|---:|---:|---:|---|---:|---:|
| FPS (fps) | **621** · p95 626 · ±1% | 358 · p95 363 · ±1% | 373 · p95 378 · ±1% | 296 · p95 302 · ±2% | BlazePlot | 1.66× | 2.09× |
| Frame p95 (ms) | **1.83** · p95 1.85 · ±2% | 3.23 · p95 3.29 · ±2% | 3.26 · p95 3.29 · ±3% | 4.19 · p95 4.25 · ±4% | BlazePlot | 1.78× | 2.28× |
| Work p50 (ms) | **1.23** · p95 1.25 · ±2% | 2.19 · p95 2.21 · ±1% | 2.42 · p95 2.44 · ±1% | 3.04 · p95 3.08 · ±1% | BlazePlot | 1.98× | 2.49× |
| Work p95 (ms) | **1.41** · p95 1.42 · ±1% | 2.51 · p95 2.57 · ±3% | 3.02 · p95 3.06 · ±3% | 3.96 · p95 4.00 · ±3% | BlazePlot | 2.14× | 2.81× |
| Ready (ms) | 10.02 · p95 10.56 · ±5% | 8.81 · p95 9.37 · ±7% | **3.55** · p95 3.75 · ±5% | 5.84 · p95 6.24 · ±5% | uPlot | 0.35× | 0.58× |
| Heap (MiB) | **9.1** · p95 9.1 · ±0% | 8.6 · p95 8.6 · ±0% | 11.5 · p95 11.5 · ±0% | 35.4 · p95 35.4 · ±0% | BlazePlot | 1.27× | 3.90× |

### Interaction

#### hover-1m

Pointer move over a 1M point line with crosshair, snapping marker and readout

| Metric | BlazePlot | BlazePlot (Canvas 2D) | uPlot | Chart.js | Winner | BlazePlot vs uPlot | BlazePlot vs Chart.js |
|---|---:|---:|---:|---:|---|---:|---:|
| Hover p50 (ms) | 0.45 · p95 0.45 · ±1% | 0.45 · p95 0.45 · ±1% | **0.22** · p95 0.23 · ±1% | 0.34 · p95 0.34 · ±1% | uPlot | 0.49× | 0.76× |
| Hover p95 (ms) | 0.51 · p95 0.52 · ±1% | 0.51 · p95 0.52 · ±2% | **0.26** · p95 0.27 · ±2% | 0.46 · p95 0.48 · ±4% | uPlot | 0.51× | 0.90× |

#### resize-1m

Container resize of a 1M point line

| Metric | BlazePlot | BlazePlot (Canvas 2D) | uPlot | Chart.js | Winner | BlazePlot vs uPlot | BlazePlot vs Chart.js |
|---|---:|---:|---:|---:|---|---:|---:|
| Resize p50 (ms) | **37.55** · p95 37.55 · ±0% | 37.08 · p95 37.51 · ±1% | 43.06 · p95 43.44 · ±1% | 43.54 · p95 43.57 · ±0% | BlazePlot | 1.15× | 1.16× |
| Resize p95 (ms) | **38.15** · p95 38.55 · ±1% | 38.05 · p95 38.08 · ±1% | 46.08 · p95 47.05 · ±3% | 47.04 · p95 47.98 · ±3% | BlazePlot | 1.21× | 1.23× |

### Lifecycle

#### many-charts-50

50 small charts (10k points each) mounted on one page

| Metric | BlazePlot | BlazePlot (Canvas 2D) | uPlot | Chart.js | Winner | BlazePlot vs uPlot | BlazePlot vs Chart.js |
|---|---:|---:|---:|---:|---|---:|---:|
| Ready (ms) | 40.16 · p95 40.53 · ±1% | 46.91 · p95 50.66 · ±5% | **21.02** · p95 22.27 · ±7% | 47.62 · p95 54.41 · ±8% | uPlot | 0.52× | 1.19× |
| Heap (MiB) | 42.9 · p95 42.9 · ±0% | 42.7 · p95 42.7 · ±0% | **9.5** · p95 9.5 · ±0% | 37.5 · p95 37.5 · ±0% | uPlot | 0.22× | 0.87× |
| Destroy (ms) | 1.26 · p95 3.34 · ±90% | 0.73 · p95 0.76 · ±12% | **0.20** · p95 0.20 · ±12% | 0.47 · p95 0.48 · ±6% | uPlot | 0.15× | 0.37× |

#### mount-destroy-cycle

Mount, first frame and destroy of a 100k point chart, repeated 40 times

| Metric | BlazePlot | BlazePlot (Canvas 2D) | uPlot | Chart.js | Winner | BlazePlot vs uPlot | BlazePlot vs Chart.js |
|---|---:|---:|---:|---:|---|---:|---:|
| Cycle p50 (ms) | 4.70 · p95 4.81 · ±2% | 2.48 · p95 2.58 · ±2% | **1.67** · p95 1.75 · ±3% | 2.18 · p95 2.46 · ±8% | uPlot | 0.36× | 0.46× |
| Cycle p95 (ms) | 5.95 · p95 6.43 · ±6% | 4.00 · p95 4.32 · ±12% | **2.44** · p95 3.02 · ±17% | 4.45 · p95 4.91 · ±16% | uPlot | 0.41× | 0.75× |
| Retained (MiB) | 1.0 · p95 1.0 · ±0% | 0.7 · p95 0.7 · ±0% | **0.3** · p95 0.3 · ±0% | 0.9 · p95 0.9 · ±12% | uPlot | 0.26× | 0.93× |

#### heap-soak-1m-pan

1M point line panned for 8 seconds; JS heap growth after GC

| Metric | BlazePlot | BlazePlot (Canvas 2D) | uPlot | Chart.js | Winner | BlazePlot vs uPlot | BlazePlot vs Chart.js |
|---|---:|---:|---:|---:|---|---:|---:|
| Heap growth (MiB) | 0.4 · p95 0.4 · ±1% | 0.3 · p95 0.3 · ±3% | 0.2 · p95 0.2 · ±65% | 0.4 · p95 0.5 · ±1% | tie (uPlot, BlazePlot) | 0.45× | 1.11× |
| FPS (fps) | **987** · p95 992 · ±1% | 607 · p95 613 · ±2% | 677 · p95 685 · ±2% | 508 · p95 517 · ±2% | BlazePlot | 1.46× | 1.94× |

#### stream-throughput

Highest live append rate that keeps 60 fps into a 100k-sample sliding window

| Metric | BlazePlot | BlazePlot (Canvas 2D) | uPlot | Chart.js | Winner | BlazePlot vs uPlot | BlazePlot vs Chart.js |
|---|---:|---:|---:|---:|---|---:|---:|
| Max rate (k samples/s) | 102400 · p95 102400 · ±0% | 102400 · p95 102400 · ±0% | 51200 · p95 102400 · ±50% | 3200 · p95 3200 · ±25% | tie (BlazePlot, uPlot) | 2.00× | 32.0× |


## Failures and skipped runs

No library runs failed or were skipped.

## Methodology

- Every sample is one fresh browser context (new renderer process and heap) measuring exactly one scenario and library; each cell aggregates 7 such runs. Runs are interleaved across libraries with a rotating order so no library always runs first.
- Before measuring, the page builds small charts of the same series type (JIT and shader warmup), then runs the full-size chart construction once and discards it. The measured chart follows a forced garbage collection. The cold-page scenario skips all warmup on purpose.
- Ready time is library construction through the end of the first frame in which the chart's content has been drawn: layout, axes and first paint included. Libraries that draw synchronously are timed through the next frame boundary, so deferred drawing (BlazePlot renders in its first animation frame) is not charged unfairly.
- Frame cost is the synchronous update/redraw call plus the time the library spends inside its own animation-frame callbacks, so a library that redraws immediately and one that defers to the next frame are charged the same way. FPS is the real animation-frame cadence with the frame-rate limit disabled, so it also reflects raster and GPU back-pressure.
- All libraries receive the same data (in their own native format), the same 1 px lines and colors, no grid, and the same axis gutters (52 px left/right, 28 px bottom), so they plot into the same rectangle. The plot size each library reports is recorded in the JSON details.
- Heap numbers are `performance.memory.usedJSHeapSize` after forced GC with precise memory info enabled: JavaScript heap only, so GPU, canvas backing-store and other native memory are not included.
- Details and caveats: [Benchmark methodology](../docs/internal/benchmarks.md).
