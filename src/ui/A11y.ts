import type { SeriesStore } from "../core/SeriesStore.js";
import type { SeriesSample } from "../core/types.js";
import type { ChartSeriesState } from "./Chart.js";
import type { ChartPlugin, ChartPluginContext } from "./PluginHost.js";
import { singleChartPlugin } from "./OverlayUtils.js";

/** Data table options for `a11yPlugin`. */
export interface A11yTableOptions {
  /** Rows per series, evenly sampled from the visible range (first and last always kept). Defaults to 100. */
  readonly maxRows?: number;
  /** Minimum milliseconds between rebuilds while the viewport or data changes. Defaults to 500. */
  readonly updateMs?: number;
  /** Header of the X column. Defaults to `"X"`. */
  readonly xLabel?: string;
  /** Header of the value column for non-OHLC series. Defaults to `"Y"`. */
  readonly yLabel?: string;
}

/** Live-region options for `a11yPlugin`. */
export interface A11yLiveOptions {
  /** Minimum milliseconds between announcements. Defaults to 10000; values below 1000 are raised to 1000. */
  readonly intervalMs?: number;
  /** Text to announce. Defaults to the latest value of each visible series. Return `""` to skip a tick. */
  readonly format?: (series: readonly ChartSeriesState[], chart: ChartPluginContext) => string;
}

/** The inspected sample, passed to `A11yPluginOptions.formatAnnouncement`. */
export interface A11yInspection {
  readonly series: ChartSeriesState;
  readonly sample: SeriesSample;
  /** 1-based position of the sample in its series. */
  readonly position: number;
  /** Samples in the series. */
  readonly total: number;
  /** Formatted X value. */
  readonly x: string;
  /** Formatted Y value (for OHLC series: open, high, low, and close). */
  readonly y: string;
}

/** Options for `a11yPlugin`. */
export interface A11yPluginOptions {
  /** Visually hidden data table of the visible data, one table per visible series. Defaults to true. */
  readonly table?: boolean | A11yTableOptions;
  /** Keyboard inspection cursor driven from the focused chart root. Defaults to true. */
  readonly inspection?: boolean;
  /** Periodic polite live-region summary for streaming charts. Off by default. */
  readonly live?: boolean | A11yLiveOptions;
  /** Format X values in the table and announcements. Defaults to the X axis label format. */
  readonly formatX?: (value: number) => string;
  /** Format Y values in the table and announcements. Defaults to the series' Y axis label format. */
  readonly formatY?: (value: number, series: ChartSeriesState) => string;
  /** Text announced for the inspected sample. */
  readonly formatAnnouncement?: (inspection: A11yInspection) => string;
}

/** The accessibility plugin with imperative helpers. */
export interface A11yPlugin extends ChartPlugin {
  /** Rebuild the data table now instead of waiting for the update throttle. */
  refresh(): void;
  /** Whether the keyboard inspection cursor is active. */
  isInspecting(): boolean;
}

const DEFAULT_MAX_ROWS = 100;
const DEFAULT_TABLE_UPDATE_MS = 500;
const DEFAULT_LIVE_INTERVAL_MS = 10_000;
const MIN_LIVE_INTERVAL_MS = 1_000;
/** Samples scanned past gaps when stepping or looking for the latest value. */
const GAP_SCAN_LIMIT = 4_096;
const INSTRUCTIONS = "Keyboard: with the chart focused, press Enter to inspect data points. "
  + "Left and Right arrows move between points, Up and Down switch series, Page Up and Page Down jump, "
  + "Home and End go to the first and last visible point, and Escape stops inspecting.";

/**
 * Logical indexes for at most `maxRows` table rows from `[start, end)`: every index when it fits,
 * otherwise evenly spaced indexes that always include the first and last one.
 */
export function sampleTableIndices(start: number, end: number, maxRows: number): number[] {
  const count = end - start;
  const rows = Math.max(0, Math.floor(maxRows));
  if (count <= 0 || rows <= 0) return [];
  if (count <= rows) return Array.from({ length: count }, (_, i) => start + i);
  if (rows === 1) return [start];
  const indices: number[] = [];
  for (let i = 0; i < rows; i++) {
    const index = start + Math.round((i * (count - 1)) / (rows - 1));
    if (indices[indices.length - 1] !== index) indices.push(index);
  }
  return indices;
}

function visuallyHide(element: HTMLElement): void {
  // Inline too, so the plugin stays hidden when the chart's stylesheet is off (`accessibility: false`).
  element.classList.add("blazeplot-visually-hidden");
  Object.assign(element.style, {
    position: "absolute", width: "1px", height: "1px", margin: "-1px", padding: "0", border: "0",
    overflow: "hidden", clipPath: "inset(50%)", whiteSpace: "nowrap",
  });
}

function seriesName(state: ChartSeriesState): string {
  return state.name ?? state.id ?? `${state.mode} ${state.index + 1}`;
}

function isOhlc(state: ChartSeriesState): boolean {
  return state.mode === "ohlc" || state.mode === "candlestick";
}

/** Last non-gap sample at or before the end of the series. */
function latestSample(series: SeriesStore): SeriesSample | null {
  const last = series.length - 1;
  for (let index = last; index >= 0 && last - index < GAP_SCAN_LIMIT; index--) {
    const sample = series.sampleAt(index);
    if (sample) return sample;
  }
  return null;
}

/** First non-gap index from `from` moving by `direction`, or -1. */
function findSample(series: SeriesStore, from: number, direction: 1 | -1): number {
  for (let index = from, scanned = 0; index >= 0 && index < series.length && scanned < GAP_SCAN_LIMIT; index += direction, scanned++) {
    if (series.sampleAt(index)) return index;
  }
  return -1;
}

/**
 * Create the accessibility plugin: a visually hidden data table of the visible data, a keyboard
 * inspection cursor that drives the tooltip and crosshair through `ctx.state.inspect`, and an
 * optional throttled live summary for streaming charts.
 */
export function a11yPlugin(options: A11yPluginOptions = {}): A11yPlugin {
  const tableOptions = options.table === false ? null : (typeof options.table === "object" ? options.table : {});
  const liveOptions = options.live ? (options.live === true ? {} : options.live) : null;
  const inspectionEnabled = options.inspection !== false;
  let rebuildTable: (() => void) | null = null;
  let inspecting = false;

  return singleChartPlugin("a11y", {
    install(chart: ChartPluginContext) {
      const formatX = options.formatX ?? ((value: number) => chart.coords.format(value, "x"));
      const formatY = options.formatY ?? ((value: number, state: ChartSeriesState) => chart.coords.format(value, "y", state.yAxis));
      const doc = document;

      const container = doc.createElement("div");
      container.className = "blazeplot-a11y";
      visuallyHide(container);
      if (inspectionEnabled) {
        const instructions = doc.createElement("p");
        instructions.textContent = INSTRUCTIONS;
        container.appendChild(instructions);
      }
      const announcer = doc.createElement("div");
      announcer.className = "blazeplot-a11y-announcer";
      announcer.setAttribute("role", "status");
      announcer.setAttribute("aria-live", "polite");
      announcer.setAttribute("aria-atomic", "true");
      container.appendChild(announcer);
      const liveRegion = liveOptions ? doc.createElement("div") : null;
      if (liveRegion) {
        liveRegion.className = "blazeplot-a11y-live";
        liveRegion.setAttribute("aria-live", "polite");
        liveRegion.setAttribute("aria-atomic", "true");
        container.appendChild(liveRegion);
      }
      const tables = doc.createElement("div");
      tables.className = "blazeplot-a11y-tables";
      container.appendChild(tables);
      chart.dom.mount("root", container);

      let announceToggle = false;
      const announce = (text: string): void => {
        // Alternate a trailing no-break space so an identical message is announced again.
        announceToggle = !announceToggle;
        announcer.textContent = announceToggle ? text : `${text} `;
      };

      // ---- Data table -------------------------------------------------------------------------
      const maxRows = Math.max(1, Math.floor(tableOptions?.maxRows ?? DEFAULT_MAX_ROWS));
      const updateMs = Math.max(0, tableOptions?.updateMs ?? DEFAULT_TABLE_UPDATE_MS);
      let tableTimer: ReturnType<typeof setTimeout> | null = null;
      let tableSignature = "";

      const formatValues = (state: ChartSeriesState, index: number, sample: SeriesSample): string[] => {
        if (isOhlc(state)) {
          const ohlc = state.series.ohlcAt(index);
          if (ohlc) return [ohlc.open, ohlc.high, ohlc.low, ohlc.close].map((value) => formatY(value, state));
        }
        return [formatY(sample.y, state)];
      };

      const buildTables = (): void => {
        if (!tableOptions) return;
        const states = chart.state.getSeries().filter((state) => state.visible);
        const ranges = states.map((state) => state.series.visibleIndexRange(chart.viewport.get(state.yAxis)));
        const viewport = chart.viewport.get();
        const signature = [viewport.xMin, viewport.xMax, ...states.flatMap((state, i) => [
          state.index, state.series.length, ranges[i]!.start, ranges[i]!.end, state.series.xRange?.end ?? "", seriesName(state),
        ])].join("|");
        if (signature === tableSignature) return;
        tableSignature = signature;

        const nodes: HTMLElement[] = [];
        for (const [i, state] of states.entries()) {
          const range = ranges[i]!;
          const visibleCount = Math.max(0, range.end - range.start);
          const name = seriesName(state);
          if (visibleCount === 0) {
            const empty = doc.createElement("p");
            empty.textContent = `${name}: no points in view.`;
            nodes.push(empty);
            continue;
          }
          const indices = sampleTableIndices(range.start, range.end, maxRows);
          const table = doc.createElement("table");
          const caption = doc.createElement("caption");
          const sampled = indices.length < visibleCount ? `, evenly sampled from ${visibleCount.toLocaleString("en-US")} visible points` : " visible";
          caption.textContent = `${name}: ${indices.length.toLocaleString("en-US")} points${sampled}`;
          table.appendChild(caption);
          const head = doc.createElement("thead");
          const headRow = doc.createElement("tr");
          const headers = [tableOptions.xLabel ?? "X", ...(isOhlc(state) ? ["Open", "High", "Low", "Close"] : [tableOptions.yLabel ?? "Y"])];
          for (const label of headers) {
            const th = doc.createElement("th");
            th.scope = "col";
            th.textContent = label;
            headRow.appendChild(th);
          }
          head.appendChild(headRow);
          table.appendChild(head);
          const body = doc.createElement("tbody");
          for (const index of indices) {
            const sample = state.series.sampleAt(index);
            if (!sample) continue;
            const row = doc.createElement("tr");
            const x = doc.createElement("th");
            x.scope = "row";
            x.textContent = formatX(sample.x);
            row.appendChild(x);
            for (const value of formatValues(state, index, sample)) {
              const cell = doc.createElement("td");
              cell.textContent = value;
              row.appendChild(cell);
            }
            body.appendChild(row);
          }
          table.appendChild(body);
          nodes.push(table);
        }
        tables.replaceChildren(...nodes);
      };

      const scheduleTable = (): void => {
        if (!tableOptions || tableTimer !== null) return;
        tableTimer = setTimeout(() => {
          tableTimer = null;
          buildTables();
        }, updateMs);
      };
      rebuildTable = () => {
        if (tableTimer !== null) clearTimeout(tableTimer);
        tableTimer = null;
        tableSignature = "";
        buildTables();
      };

      // ---- Keyboard inspection ----------------------------------------------------------------
      let active: { series: SeriesStore; index: number } | null = null;

      const stateOf = (series: SeriesStore): ChartSeriesState | undefined => chart.state.getSeries().find((state) => state.series === series);
      const inspectable = (): ChartSeriesState[] => chart.state.getSeries().filter((state) => state.visible && state.series.length > 0);

      const describe = (state: ChartSeriesState, index: number): string => {
        const sample = state.series.sampleAt(index);
        if (!sample) return `${seriesName(state)}: no value at this point.`;
        const values = formatValues(state, index, sample);
        const y = isOhlc(state) ? `open ${values[0]}, high ${values[1]}, low ${values[2]}, close ${values[3]}` : values[0]!;
        const inspection: A11yInspection = { series: state, sample, position: index + 1, total: state.series.length, x: formatX(sample.x), y };
        if (options.formatAnnouncement) return options.formatAnnouncement(inspection);
        return `${seriesName(state)}: x ${inspection.x}, y ${inspection.y}. Point ${inspection.position.toLocaleString("en-US")} of ${inspection.total.toLocaleString("en-US")}.`;
      };

      /** Pan just enough to bring the sample into view, so the tooltip and crosshair can show it. */
      const scrollIntoView = (state: ChartSeriesState, sample: SeriesSample): void => {
        const rect = chart.layout.plotRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        const [plotX, plotY] = chart.coords.dataToPlot(sample.x, sample.y, state.yAxis);
        const fx = plotX / rect.width;
        const fy = plotY / rect.height;
        const dataFx = chart.viewport.isReversed("x", state.yAxis) ? 1 - fx : fx;
        const dataFy = chart.viewport.isReversed("y", state.yAxis) ? fy : 1 - fy;
        const shift = (fraction: number): number => (fraction < 0 ? fraction - 0.1 : fraction > 1 ? fraction - 0.9 : 0);
        const dx = Number.isFinite(dataFx) ? shift(dataFx) : 0;
        const dy = Number.isFinite(dataFy) ? shift(dataFy) : 0;
        if (dx !== 0 || dy !== 0) chart.viewport.pan({ dx, dy }, state.yAxis);
      };

      const setActive = (state: ChartSeriesState, index: number): void => {
        const sample = state.series.sampleAt(index);
        if (!sample) return;
        active = { series: state.series, index };
        inspecting = true;
        scrollIntoView(state, sample);
        chart.state.inspect(active);
        announce(describe(state, index));
      };

      const stopInspection = (message: string | null): void => {
        if (!inspecting) return;
        inspecting = false;
        active = null;
        if (chart.state.getInspection()) chart.state.inspect(null);
        if (message) announce(message);
      };

      const startInspection = (): boolean => {
        const rect = chart.layout.plotRect();
        for (const state of inspectable()) {
          const viewport = chart.viewport.get(state.yAxis);
          const center = chart.coords.clientToData(rect.left + rect.width / 2, rect.top + rect.height / 2, state.yAxis);
          const sample = center ? state.series.nearestSampleByX(center[0], viewport) : null;
          if (!sample) continue;
          setActive(state, sample.index);
          return true;
        }
        announce("No data points in view to inspect.");
        return false;
      };

      /** Move by `steps` samples in screen direction (positive is right). */
      const step = (state: ChartSeriesState, steps: number): void => {
        if (!active) return;
        const direction = (chart.viewport.isReversed("x", state.yAxis) ? -steps : steps) > 0 ? 1 : -1;
        const length = state.series.length;
        const target = Math.min(length - 1, Math.max(0, Math.min(active.index, length - 1) + direction * Math.abs(steps)));
        let index = findSample(state.series, target, direction);
        if (index === -1) index = findSample(state.series, target, direction === 1 ? -1 : 1);
        if (index !== -1) setActive(state, index);
      };

      /** Home/End: the first/last visible sample on screen; pressed again there, the first/last sample overall. */
      const jump = (state: ChartSeriesState, toEnd: boolean): void => {
        if (!active) return;
        const range = state.series.visibleIndexRange(chart.viewport.get(state.yAxis));
        const dataEnd = toEnd !== chart.viewport.isReversed("x", state.yAxis);
        const direction: 1 | -1 = dataEnd ? -1 : 1;
        let index = range.end > range.start ? findSample(state.series, dataEnd ? range.end - 1 : range.start, direction) : -1;
        if (index === -1 || index === active.index) index = findSample(state.series, dataEnd ? state.series.length - 1 : 0, direction);
        if (index !== -1) setActive(state, index);
      };

      const switchSeries = (state: ChartSeriesState, offset: 1 | -1): void => {
        if (!active) return;
        const list = inspectable();
        if (list.length === 0) return;
        const current = list.findIndex((item) => item.series === state.series);
        const next = list[(current + offset + list.length) % list.length]!;
        const x = state.series.sampleAt(active.index)?.x;
        const sample = x === undefined ? null : next.series.nearestSampleByX(x);
        const index = sample?.index ?? findSample(next.series, 0, 1);
        if (index !== -1) setActive(next, index);
      };

      const onInspectionKey = (event: KeyboardEvent): void => {
        if (!inspecting || !active || event.target !== event.currentTarget || event.defaultPrevented) return;
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        // Shift+Arrow belongs to keyboard selection (or the chart's faster pan).
        if (event.shiftKey && event.key.startsWith("Arrow")) return;
        const state = stateOf(active.series);
        if (!state || !state.visible) {
          stopInspection(null);
          return;
        }
        const page = Math.max(1, Math.round(state.series.visibleSampleCount(chart.viewport.get(state.yAxis)) / 10));
        switch (event.key) {
          case "ArrowRight": step(state, 1); break;
          case "ArrowLeft": step(state, -1); break;
          case "PageDown": step(state, page); break;
          case "PageUp": step(state, -page); break;
          case "ArrowDown": switchSeries(state, 1); break;
          case "ArrowUp": switchSeries(state, -1); break;
          case "Home": jump(state, false); break;
          case "End": jump(state, true); break;
          case "Escape": stopInspection("Stopped inspecting points."); break;
          default: return;
        }
        event.preventDefault();
      };

      const onStartKey = (event: KeyboardEvent): void => {
        // Bubble phase: a selection commit (or any handler that consumed Enter) runs first.
        if (inspecting || event.key !== "Enter" || event.target !== event.currentTarget || event.defaultPrevented) return;
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        startInspection();
        event.preventDefault();
      };

      if (inspectionEnabled) {
        // Capture on the root runs before the chart's own arrow-key pan on the same element.
        chart.dom.listen("root", "keydown", onInspectionKey, { capture: true });
        chart.dom.listen("root", "keydown", onStartKey);
        chart.dom.listen("root", "blur", () => stopInspection(null));
        chart.events.subscribe("hover", () => {
          // A pointer over the plot ends inspection in the chart; follow it.
          if (inspecting && chart.state.getInspection() === null) {
            inspecting = false;
            active = null;
          }
        });
      }

      chart.events.subscribe("serieschange", () => {
        scheduleTable();
        if (!active) return;
        const state = stateOf(active.series);
        if (state?.visible) return;
        const fallback = inspectable()[0];
        if (fallback) {
          const index = findSample(fallback.series, 0, 1);
          if (index !== -1) {
            setActive(fallback, index);
            return;
          }
        }
        stopInspection("No visible series to inspect.");
      });
      chart.events.subscribe("viewportchange", scheduleTable);
      chart.events.subscribe("render", scheduleTable);

      // ---- Live summary -----------------------------------------------------------------------
      let liveTimer: ReturnType<typeof setInterval> | null = null;
      if (liveRegion && liveOptions) {
        const intervalMs = Math.max(MIN_LIVE_INTERVAL_MS, liveOptions.intervalMs ?? DEFAULT_LIVE_INTERVAL_MS);
        let lastLive = "";
        const announceLive = (): void => {
          if (inspecting) return;
          const states = chart.state.getSeries().filter((state) => state.visible);
          const text = liveOptions.format
            ? liveOptions.format(states, chart)
            : defaultLiveText(states, formatX, formatY);
          if (!text || text === lastLive) return;
          lastLive = text;
          liveRegion.textContent = text;
        };
        liveTimer = setInterval(announceLive, intervalMs);
      }

      scheduleTable();

      return {
        dispose() {
          if (tableTimer !== null) clearTimeout(tableTimer);
          if (liveTimer !== null) clearInterval(liveTimer);
          tableTimer = null;
          liveTimer = null;
          stopInspection(null);
          rebuildTable = null;
        },
      };
    },
    refresh(): void {
      rebuildTable?.();
    },
    isInspecting(): boolean {
      return inspecting;
    },
  });
}

function defaultLiveText(
  states: readonly ChartSeriesState[],
  formatX: (value: number) => string,
  formatY: (value: number, series: ChartSeriesState) => string,
): string {
  const parts: string[] = [];
  for (const state of states) {
    const sample = latestSample(state.series);
    if (sample) parts.push(`${seriesName(state)} ${formatY(sample.y, state)} at ${formatX(sample.x)}`);
  }
  return parts.length ? `Latest: ${parts.join("; ")}.` : "";
}
