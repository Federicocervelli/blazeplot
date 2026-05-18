# BlazePlot benchmark results

This file is appended by `bun run bench:report` so benchmark runs remain easy to compare over time.

## 2026-05-18T20:19:11.362Z

Command: `bun run bench:report --scenario mixed-1m-live --measure-ms 500 --warmup-ms 100 --top 5`

| Scenario | Browser | Canvas | Renderer | RAF FPS | RAF p95 ms | Chart p50 ms | Chart p95 ms | Points | Draws | Upload KB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| mixed-1m-live | brave | 1228x611 | mixed | 60.0 | 16.70 | 1.80 | 2.80 | 16,140 | 4 | 126.4 |

### CPU hot spots: mixed-1m-live

| Function | Self ms | Total ms | Location |
|---|---:|---:|---|
| (idle) | 365.3 | 365.3 | runtime |
| (program) | 82.9 | 82.9 | runtime |
| appendRange | 53.2 | 54.7 | main.ts:244 |
| queryPhysicalMinMax | 16.5 | 16.5 | RingBuffer.ts:170 |
| renderStatus | 7.8 | 7.8 | main.ts:292 |

