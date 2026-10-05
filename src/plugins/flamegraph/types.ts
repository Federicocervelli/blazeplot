/**
 * Public flame graph types: frames, models, build options, picks, and the plugin options and handle.
 * Everything here is `@experimental`. A leaf module shared by the model builder, the renderer, and the plugin.
 */
import type { RgbaColor } from "../../core/types.js";
import type { ChartPlugin } from "../../ui/PluginTypes.js";

/**
 * Input frame for building a flame graph model.
 *
 * @experimental May change in a minor release before it is promoted to stable. See docs/stability.md.
 */
export interface FlameGraphFrame<T = unknown> {
  readonly name: string;
  readonly start: number;
  readonly value: number;
  readonly depth: number;
  readonly color?: RgbaColor;
  readonly id?: string;
  readonly metadata?: T;
  readonly parent?: number;
}

/**
 * Frame with computed layout fields used for rendering and picking.
 *
 * @experimental May change in a minor release before it is promoted to stable. See docs/stability.md.
 */
export interface FlameGraphRenderableFrame<T = unknown> extends FlameGraphFrame<T> {
  readonly end: number;
  readonly index: number;
}

/**
 * Index range for frames at one rendered depth.
 *
 * @experimental May change in a minor release before it is promoted to stable. See docs/stability.md.
 */
export interface FlameGraphLevelIndex {
  readonly depth: number;
  readonly indices: readonly number[];
  readonly starts: readonly number[];
}

/**
 * Prepared flame graph model consumed by the plugin.
 *
 * @experimental May change in a minor release before it is promoted to stable. See docs/stability.md.
 */
export interface FlameGraphModel<T = unknown> {
  readonly frames: readonly FlameGraphRenderableFrame<T>[];
  readonly levels: readonly FlameGraphLevelIndex[];
  readonly total: number;
  readonly minX: number;
  readonly maxX: number;
  readonly maxDepth: number;
  readonly countName: string;
}

/**
 * Parsed folded-stack sample.
 *
 * @experimental May change in a minor release before it is promoted to stable. See docs/stability.md.
 */
export interface FlameGraphFoldedStack<T = unknown> {
  readonly stack: string | readonly string[];
  readonly value: number;
  readonly delta?: number;
  readonly metadata?: T;
}

/**
 * Time span used to build a status-chart style model.
 *
 * @experimental May change in a minor release before it is promoted to stable. See docs/stability.md.
 */
export interface FlameGraphStatusSpan<T = unknown> {
  readonly name: string;
  readonly start: number;
  readonly end?: number;
  readonly value?: number;
  readonly depth?: number;
  readonly color?: RgbaColor;
  readonly id?: string;
  readonly metadata?: T;
}

/**
 * Options for building a flame graph model from frames or folded stacks.
 *
 * @experimental May change in a minor release before it is promoted to stable. See docs/stability.md.
 */
export interface BuildFlameGraphModelOptions {
  readonly separator?: string;
  readonly flameChart?: boolean;
  readonly includeRoot?: boolean;
  readonly rootName?: string;
  readonly countName?: string;
  readonly sort?: boolean | ((a: string, b: string) => number);
}

/**
 * Options for building a status-chart model from spans.
 *
 * @experimental May change in a minor release before it is promoted to stable. See docs/stability.md.
 */
export interface BuildStatusChartModelOptions {
  readonly countName?: string;
}

/**
 * Result from picking a flame graph frame.
 *
 * @experimental May change in a minor release before it is promoted to stable. See docs/stability.md.
 */
export interface FlameGraphPick<T = unknown> {
  readonly frame: FlameGraphRenderableFrame<T>;
  readonly plotX: number;
  readonly plotY: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly dataX: number;
  readonly dataY: number;
  readonly percent: number;
}

/**
 * Options for the flame graph plugin.
 *
 * @experimental May change in a minor release before it is promoted to stable. See docs/stability.md.
 */
export interface FlameGraphPluginOptions<T = unknown> {
  readonly model?: FlameGraphModel<T>;
  readonly foldedStacks?: string | readonly FlameGraphFoldedStack<T>[];
  readonly statusSpans?: readonly FlameGraphStatusSpan<T>[];
  readonly build?: BuildFlameGraphModelOptions;
  readonly autoFit?: boolean;
  readonly inverted?: boolean;
  readonly minFrameWidthPx?: number;
  readonly minFrameHeightPx?: number;
  readonly labelMinWidthPx?: number;
  readonly frameGapPx?: number;
  readonly font?: string;
  readonly textColor?: string;
  readonly highlightColor?: RgbaColor;
  readonly hoverHighlight?: boolean;
  readonly hoverHighlightColor?: RgbaColor;
  readonly search?: string | RegExp | null;
  readonly tooltip?: boolean;
  readonly tooltipClassName?: string;
  readonly tooltipFormatter?: (pick: FlameGraphPick<T>, model: FlameGraphModel<T>) => string;
  readonly onFrameHover?: (pick: FlameGraphPick<T> | null) => void;
  readonly onFrameClick?: (pick: FlameGraphPick<T>, event: MouseEvent) => void;
  readonly zIndex?: number;
}

/**
 * Flame graph plugin with imperative model and selection hooks.
 *
 * @experimental May change in a minor release before it is promoted to stable. See docs/stability.md.
 */
export interface FlameGraphPlugin<T = unknown> extends ChartPlugin {
  setModel(model: FlameGraphModel<T>): void;
  setFoldedStacks(stacks: string | readonly FlameGraphFoldedStack<T>[], options?: BuildFlameGraphModelOptions): void;
  setStatusSpans(spans: readonly FlameGraphStatusSpan<T>[], options?: BuildStatusChartModelOptions): void;
  setSearch(search: string | RegExp | null): void;
  fitToData(): void;
  pick(clientX: number, clientY: number): FlameGraphPick<T> | null;
  dispose(): void;
}
