import { describe, expect, it } from "bun:test";
import { DEFAULT_CHART_THEME, LIGHT_CHART_THEME } from "../../src/ui/theme.ts";
import { useChartHarness } from "./harness.ts";

const h = useChartHarness();

function stubColorScheme(light: boolean) {
  const original = window.matchMedia;
  const listeners = new Set<() => void>();
  const query = {
    media: "(prefers-color-scheme: light)",
    matches: light,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  window.matchMedia = ((media: string) => (media === query.media ? query : original.call(window, media))) as typeof window.matchMedia;
  return {
    listeners,
    set(next: boolean) {
      query.matches = next;
      for (const listener of listeners) listener();
    },
    restore() {
      window.matchMedia = original;
    },
  };
}

describe('theme: "auto"', () => {
  it("uses the dark theme unless the user prefers light, and follows live changes", () => {
    const scheme = stubColorScheme(false);
    try {
      const chart = h.make({ theme: "auto" });
      expect(chart.theme.backgroundCssColor).toBe(DEFAULT_CHART_THEME.backgroundCssColor);
      let themeChanges = 0;
      chart.subscribe("themechange", () => themeChanges++);

      scheme.set(true);
      expect(chart.theme.backgroundCssColor).toBe(LIGHT_CHART_THEME.backgroundCssColor);
      expect(chart.theme.axisColor).toBe(LIGHT_CHART_THEME.axisColor);
      expect(themeChanges).toBe(1);

      scheme.set(false);
      expect(chart.theme.backgroundCssColor).toBe(DEFAULT_CHART_THEME.backgroundCssColor);
      expect(themeChanges).toBe(2);

      chart.dispose();
      expect(scheme.listeners.size).toBe(0);
    } finally {
      scheme.restore();
    }
  });

  it("starts light when the preference is already light", () => {
    const scheme = stubColorScheme(true);
    try {
      const chart = h.make({ theme: "auto" });
      expect(chart.theme.backgroundCssColor).toBe(LIGHT_CHART_THEME.backgroundCssColor);
      chart.dispose();
    } finally {
      scheme.restore();
    }
  });

  it("stops following the preference once an explicit theme replaces it", () => {
    const scheme = stubColorScheme(false);
    try {
      const chart = h.make({ theme: "auto" });
      expect(scheme.listeners.size).toBe(1);
      chart.setTheme(LIGHT_CHART_THEME);
      expect(scheme.listeners.size).toBe(0);
      scheme.set(true);
      expect(chart.theme.backgroundCssColor).toBe(LIGHT_CHART_THEME.backgroundCssColor);
      chart.setTheme("auto");
      expect(scheme.listeners.size).toBe(1);
      chart.dispose();
      expect(scheme.listeners.size).toBe(0);
    } finally {
      scheme.restore();
    }
  });

  it("does not watch the preference for an explicit or default theme", () => {
    const scheme = stubColorScheme(true);
    try {
      const chart = h.make();
      expect(scheme.listeners.size).toBe(0);
      expect(chart.theme.backgroundCssColor).toBe(DEFAULT_CHART_THEME.backgroundCssColor);
      chart.dispose();
    } finally {
      scheme.restore();
    }
  });
});
