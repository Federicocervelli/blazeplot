import type { Camera2D } from "../interaction/Camera2D.js";
import type { AxisController } from "../interaction/AxisController.js";
import type { SeriesStore } from "../core/SeriesStore.js";
import { domainsAlmostEqual } from "./ChartConfig.js";
import type { ChartFollowXOptions, ChartFollowXState } from "./ChartTypes.js";

/** What the follow-X policy reads from and writes to the chart. */
export interface FollowXHost {
  camera(): Camera2D;
  axis(): AxisController;
  /** Visible series that pass the options' series and `includeHidden` filters. */
  candidates(options: ChartFollowXOptions): readonly SeriesStore[];
  /** The follow state (off, following, paused) changed. */
  onStateChange(): void;
  /** The follow policy moved the X viewport. */
  onViewportChange(): void;
  requestRender(): void;
}

/** Latest-X following: keeps the X viewport on the newest data until interaction pauses it. */
export class FollowXController {
  private config: ChartFollowXOptions | null;
  private paused = false;
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly host: FollowXHost) {
    this.config = null;
  }

  /** Set the initial options without applying them (constructor use, before the camera exists). */
  configure(options: ChartFollowXOptions | null): void {
    this.config = options;
  }

  /** Active options, or `null` when following is off. */
  get options(): ChartFollowXOptions | null {
    return this.config;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get state(): ChartFollowXState {
    if (!this.config) return "off";
    return this.paused ? "paused" : "following";
  }

  /** Follow with `options`, replacing any previous options and un-pausing. */
  start(options: ChartFollowXOptions): void {
    this.config = options;
    this.clearTimer();
    this.paused = false;
    this.host.onStateChange();
    this.apply();
    this.host.requestRender();
  }

  /** Turn following off; returns whether anything changed. */
  stop(): boolean {
    if (!this.config && !this.paused) return false;
    this.config = null;
    this.paused = false;
    this.clearTimer();
    this.host.onStateChange();
    this.host.requestRender();
    return true;
  }

  /** Pause or resume without changing the options; returns whether the paused flag changed. */
  setPaused(paused: boolean): boolean {
    this.clearTimer();
    if (this.paused === paused) return false;
    this.paused = paused;
    this.host.onStateChange();
    if (!paused) this.apply();
    this.host.requestRender();
    return true;
  }

  /** Pause after a user viewport gesture (when enabled) and schedule the optional auto-resume. */
  pauseForInteraction(): void {
    const config = this.config;
    if (!config || config.pauseOnInteraction === false) return;
    const wasPaused = this.paused;
    this.paused = true;
    this.clearTimer();
    if (!wasPaused) this.host.onStateChange();
    const resumeAfterMs = config.resumeAfterMs;
    if (typeof resumeAfterMs !== "number" || !Number.isFinite(resumeAfterMs) || resumeAfterMs <= 0) return;
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = null;
      this.setPaused(false);
    }, resumeAfterMs);
  }

  clearTimer(): void {
    if (this.resumeTimer === null) return;
    clearTimeout(this.resumeTimer);
    this.resumeTimer = null;
  }

  /** Move the X viewport so its right edge sits on the newest data (or the `currentX` clock). */
  apply(): void {
    const config = this.config;
    if (!config || this.paused) return;

    let xMax = -Infinity;
    for (const series of this.host.candidates(config)) {
      const range = series.xRange;
      if (range) xMax = Math.max(xMax, range.end);
    }
    const clockX = config.currentX?.();
    if (clockX !== undefined && Number.isFinite(clockX)) xMax = Math.max(xMax, clockX);
    if (!Number.isFinite(xMax)) return;

    const camera = this.host.camera();
    const span = typeof config.window === "number" && Number.isFinite(config.window) && config.window > 0
      ? config.window
      : camera.xMax - camera.xMin;
    const xMin = xMax - span;
    if (domainsAlmostEqual(camera.xMin, camera.xMax, xMin, xMax) || !this.host.axis().isValidDomain("x", xMin, xMax)) return;
    camera.setViewport({ xMin, xMax });
    this.host.onViewportChange();
  }
}
