import { describe, expect, it } from "bun:test";
import { SeriesStore } from "../../src/core/SeriesStore.ts";
import { RingBuffer } from "../../src/core/RingBuffer.ts";
import { testStyle } from "../helpers.ts";
import { useChartHarness } from "./harness.ts";

const h = useChartHarness();

describe("series.setStyle", () => {
  it("merges options, resolves CSS colors, and is reflected in series state and events", () => {
    const chart = h.make();
    const series = chart.addLine({ capacity: 4 }, { lineWidth: 3 });
    let changes = 0;
    chart.subscribe("serieschange", () => changes++);

    series.setStyle({ color: "#ff0000", pointSize: 7 });
    expect(series.style.color).toEqual([1, 0, 0, 1]);
    expect(series.style.lineWidth).toBe(3);
    expect(series.style.pointSize).toBe(7);
    expect(chart.getSeriesState()[0]!.color).toEqual([1, 0, 0, 1]);
    expect(changes).toBe(1);

    series.setStyle({ color: undefined, lineWidth: 2 });
    expect(series.style.color).toEqual([1, 0, 0, 1]);
    expect(series.style.lineWidth).toBe(2);

    chart.start();
    h.raf.flush();
    chart.dispose();
  });

  it("derives fill and candle colors from a new color unless they were set explicitly", () => {
    const chart = h.make();
    const series = chart.addArea({ capacity: 4 }, { fillColor: [0, 1, 0, 0.5] });
    series.setStyle({ color: [0, 0, 1, 1] });
    expect(series.style.fillColor).toEqual([0, 1, 0, 0.5]);
    expect(series.style.wickColor).toEqual([0, 0, 1, 1]);
    chart.dispose();
  });

  it("is kept after forced colors turn off", () => {
    const original = window.matchMedia;
    const listeners = new Set<() => void>();
    const query = {
      media: "(forced-colors: active)",
      matches: false,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    };
    window.matchMedia = ((media: string) => (media === "(forced-colors: active)" ? query : original.call(window, media))) as typeof window.matchMedia;
    try {
      const chart = h.make();
      const series = chart.addLine({ capacity: 4 }, { color: [0.1, 0.2, 0.3, 1] });
      query.matches = true;
      for (const listener of listeners) listener();
      const forcedColor = series.style.color;
      expect(forcedColor).toEqual(chart.theme.seriesColors[0]!);

      series.setStyle({ color: "#ff0000", lineWidth: 4 });
      // Forced colors still win while active, but the width applies immediately.
      expect(series.style.color).toEqual(forcedColor);
      expect(series.style.lineWidth).toBe(4);

      query.matches = false;
      for (const listener of listeners) listener();
      expect(series.style.color).toEqual([1, 0, 0, 1]);
      expect(series.style.lineWidth).toBe(4);
      chart.dispose();
    } finally {
      window.matchMedia = original;
    }
  });

  it("throws for a series that no chart owns", () => {
    const series = new SeriesStore(new RingBuffer(4), { mode: "line", capacity: 4 }, testStyle());
    expect(() => series.setStyle({ color: "#ff0000" })).toThrow(TypeError);
  });
});

describe("default series colors", () => {
  it("does not repeat a color still in use after removeSeries", () => {
    const chart = h.make();
    const a = chart.addLine({ capacity: 4 });
    const b = chart.addLine({ capacity: 4 });
    const c = chart.addLine({ capacity: 4 });
    chart.removeSeries(a);
    const d = chart.addLine({ capacity: 4 });
    expect(d.style.color).not.toEqual(b.style.color);
    expect(d.style.color).not.toEqual(c.style.color);
    chart.dispose();
  });

  it("keeps assigning palette colors in order without removals", () => {
    const chart = h.make();
    const palette = chart.theme.seriesColors;
    const colors = [0, 1, 2].map(() => chart.addLine({ capacity: 4 }).style.color);
    expect(colors).toEqual([palette[0]!, palette[1]!, palette[2]!]);
    chart.dispose();
  });

  it("recolors palette-colored series on setTheme but not explicitly colored ones", () => {
    const chart = h.make();
    const themed = chart.addLine({ capacity: 4 });
    const pinned = chart.addLine({ capacity: 4 }, { color: [0.5, 0.5, 0.5, 1] });
    const pinnedLater = chart.addLine({ capacity: 4 });
    pinnedLater.setStyle({ color: [0.2, 0.4, 0.6, 1] });

    chart.setTheme({ seriesColors: [[1, 0, 0, 1], [0, 1, 0, 1], [0, 0, 1, 1]] });
    expect(themed.style.color).toEqual([1, 0, 0, 1]);
    expect(pinned.style.color).toEqual([0.5, 0.5, 0.5, 1]);
    expect(pinnedLater.style.color).toEqual([0.2, 0.4, 0.6, 1]);
    expect(chart.getSeriesState()[0]!.color).toEqual([1, 0, 0, 1]);
    chart.dispose();
  });
});
