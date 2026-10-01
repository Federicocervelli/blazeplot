import { Chart } from "../../../../src/index.ts";
import { crosshairPlugin } from "../../../../src/plugins/crosshair.ts";
import { interactionsPlugin } from "../../../../src/plugins/interactions.ts";
import { legendPlugin } from "../../../../src/plugins/legend.ts";
import { tooltipPlugin } from "../../../../src/plugins/tooltip.ts";
import { PreviewResources } from "./resources.ts";

export default class Preview extends PreviewResources {
  override mount(target: HTMLElement): void {
    const root = target.closest<HTMLElement>("section") ?? target;
    const status = root.querySelector<HTMLElement>("[data-sensor-status]");
    const liveButton = root.querySelector<HTMLButtonElement>("[data-sensor-live]");

    const chart = new Chart(target, {
      axes: { x: { position: "outside", scale: "time" }, y: { position: "outside" }, y2: { visible: true, position: "outside" } },
      grid: true,
      autoFitY: { padding: { y: 0.15 }, yAxis: "both" },
      plugins: [
        interactionsPlugin({ minDragDistancePx: 4 }),
        tooltipPlugin(),
        crosshairPlugin({ snap: "nearest-x", label: true }),
        legendPlugin({ position: "top-left" }),
      ],
    });
    this.previewCharts.push(chart);

    const temperature = chart.addLine({ capacity: 20_000, name: "temperature °C" }, { color: [0.988, 0.29, 0.02, 1], lineWidth: 2 });
    const humidity = chart.addLine({ capacity: 20_000, name: "humidity %" }, { color: [0.2, 0.85, 0.45, 1], lineWidth: 1.5 });
    const vibration = chart.addLine({ capacity: 20_000, name: "vibration RMS", yAxis: "right" }, { color: [0.2, 0.7, 1, 1], lineWidth: 1.5 });

    const streamStartMs = Date.now();
    let nextSampleAt = streamStartMs - 60_000;
    let tick = 0;
    let timeoutId = 0;
    let dropoutUntil = -Infinity;

    const nextSensorInterval = (): number => 12 + Math.random() * 18;

    const sensorValues = (timestampMs: number): { temp: number; humidity: number; vibe: number } => {
      const seconds = (timestampMs - streamStartMs) / 1000;
      const dutyCycle = Math.sin(seconds * 0.23) > 0.72 ? 1 : 0;
      const temp = 24
        + Math.sin(seconds * 0.055) * 2.2
        + Math.sin(seconds * 0.72) * 0.42
        + dutyCycle * 0.9
        + (Math.random() - 0.5) * 0.18;
      const humidity = 50
        - (temp - 24) * 1.45
        + Math.sin(seconds * 0.031 + 1.7) * 3.8
        + (Math.random() - 0.5) * 0.35;
      const spike = Math.random() < 0.012 ? 0.4 + Math.random() * 0.8 : 0;
      const vibe = 0.42
        + Math.abs(Math.sin(seconds * 16.5)) * 0.075
        + Math.sin(seconds * 0.9) * 0.035
        + dutyCycle * 0.16
        + spike
        + Math.random() * 0.035;
      return { temp, humidity, vibe };
    };

    const isHistoricalDropout = (timestampMs: number): boolean => {
      const offset = timestampMs - streamStartMs;
      return (offset > -45_000 && offset < -43_700) || (offset > -21_500 && offset < -20_300) || (offset > -7_800 && offset < -7_000);
    };

    const seedX: number[] = [];
    const seedTemp: number[] = [];
    const seedHumidity: number[] = [];
    const seedVibration: number[] = [];
    while (nextSampleAt < streamStartMs) {
      const timestamp = nextSampleAt;
      const values = sensorValues(timestamp);
      const missing = isHistoricalDropout(timestamp);
      seedX.push(timestamp);
      seedTemp.push(missing ? NaN : values.temp);
      seedHumidity.push(missing ? NaN : values.humidity);
      seedVibration.push(missing ? NaN : values.vibe);
      nextSampleAt += nextSensorInterval();
    }
    temperature.append({ x: Float64Array.from(seedX), y: Float32Array.from(seedTemp) });
    humidity.append({ x: Float64Array.from(seedX), y: Float32Array.from(seedHumidity) });
    vibration.append({ x: Float64Array.from(seedX), y: Float32Array.from(seedVibration) });

    const updateStatus = (delay: number, batchCount: number, missingCount: number, values: { temp: number; humidity: number; vibe: number }): void => {
      if (!status) return;
      const dropout = missingCount > 0 ? ` · ${missingCount} dropout gaps` : "";
      status.textContent = `samples ${tick.toLocaleString()} · batch ${batchCount} · next ${Math.round(delay)}ms · ${values.temp.toFixed(2)}°C · ${values.humidity.toFixed(1)}% RH · ${values.vibe.toFixed(3)} RMS${dropout}`;
    };

    const schedule = (): void => {
      const delay = 70 + Math.random() * 110;
      timeoutId = window.setTimeout(() => {
        const flushNow = Date.now();
        const xBatch: number[] = [];
        const tempBatch: number[] = [];
        const humidityBatch: number[] = [];
        const vibrationBatch: number[] = [];
        let missingCount = 0;
        let latest = sensorValues(nextSampleAt);
        while (nextSampleAt <= flushNow && xBatch.length < 96) {
          const timestamp = nextSampleAt;
          if (timestamp > dropoutUntil && tick > 0 && tick % 600 === 0) dropoutUntil = timestamp + 850 + Math.random() * 450;
          const missing = timestamp < dropoutUntil;
          latest = sensorValues(timestamp);
          xBatch.push(timestamp);
          tempBatch.push(missing ? NaN : latest.temp);
          humidityBatch.push(missing ? NaN : latest.humidity);
          vibrationBatch.push(missing ? NaN : latest.vibe);
          if (missing) missingCount += 1;
          tick += 1;
          nextSampleAt += nextSensorInterval();
        }
        if (xBatch.length > 0) {
          temperature.append({ x: Float64Array.from(xBatch), y: Float32Array.from(tempBatch) });
          humidity.append({ x: Float64Array.from(xBatch), y: Float32Array.from(humidityBatch) });
          vibration.append({ x: Float64Array.from(xBatch), y: Float32Array.from(vibrationBatch) });
          updateStatus(delay, xBatch.length, missingCount, latest);
        }
        schedule();
      }, delay);
    };

    const onLive = (): void => chart.setXFollowPaused(false);
    liveButton?.addEventListener("click", onLive);
    if (liveButton) this.previewDisposers.push(() => liveButton.removeEventListener("click", onLive));
    this.previewDisposers.push(() => window.clearTimeout(timeoutId));

    chart.fitToData({ padding: { x: 0.02, y: 0.12 } });
    chart.followLatestX({ window: 30_000, pauseOnInteraction: true, currentX: () => Date.now() });
    chart.start();
    schedule();
  }

}
