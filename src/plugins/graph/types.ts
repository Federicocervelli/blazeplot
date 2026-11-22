/**
 * Public types of the graph plugin: nodes and edges, their styles, the callbacks that draw node
 * content and edge labels, events, and the plugin handle.
 */
import type { RgbaColor } from "../../core/types.js";
import type { ChartPlugin } from "../../ui/PluginTypes.js";

/** A color: any CSS color the browser accepts (including `var(--token)`), or a 0-1 RGBA tuple. */
export type GraphColor = string | RgbaColor;

/**
 * A node. Positions are in graph units with y pointing down, the way a layout or a design tool
 * places boxes; at zoom 1 one graph unit is one CSS pixel.
 */
export interface GraphNode<N = unknown> {
  /** Unique within the graph. */
  readonly id: string;
  /** The node's center, in graph units. */
  readonly x: number;
  readonly y: number;
  /** Text the default node renderer draws and keyboard focus announces. Defaults to `id`. */
  readonly label?: string;
  /** Anything the app wants back in callbacks. */
  readonly data?: N;
}

/** A directed edge between two nodes, by id. */
export interface GraphEdge<E = unknown> {
  /**
   * Unique within the graph. Defaults to `"<source>-><target>"`, so parallel edges need their own ids; an id used
   * twice keeps its first edge, with a warning when ids are first looked up.
   */
  readonly id?: string;
  readonly source: string;
  readonly target: string;
  /** Text the default edge label renderer draws (nothing when unset). */
  readonly label?: string;
  readonly data?: E;
}

/**
 * Edges as parallel arrays of node indices (positions in the `nodes` array), for graphs with millions of edges:
 * no object per edge is made or kept. Optional per-edge ids, labels, and data share the same index.
 */
export interface GraphEdgeArrays<E = unknown> {
  readonly source: Uint32Array | Int32Array | readonly number[];
  readonly target: Uint32Array | Int32Array | readonly number[];
  readonly ids?: readonly (string | undefined)[];
  readonly labels?: readonly (string | undefined)[];
  readonly data?: readonly E[];
}

/** What an item is doing right now, passed to style functions and renderers. */
export interface GraphItemState {
  /** The pointer is over it. */
  readonly hovered: boolean;
  /** It has keyboard focus. */
  readonly focused: boolean;
  /** It is selected (`plugin.select`). */
  readonly selected: boolean;
  /** It is being dragged (nodes only). */
  readonly dragging: boolean;
}

/** How a node is drawn by the GPU layer. Sizes in graph units scale with zoom; widths in CSS pixels do not. */
export interface GraphNodeStyle {
  /** `"circle"` (the default) uses `width` as its diameter; `"rect"` is a box with `cornerRadius`. */
  readonly shape?: "circle" | "rect";
  /** Graph units. Defaults to 12. */
  readonly width?: number;
  /** Graph units, for `"rect"`. Defaults to `width`. */
  readonly height?: number;
  /** Graph units, for `"rect"`. Half the shorter side makes a pill. Defaults to 0. */
  readonly cornerRadius?: number;
  /** Defaults to the theme's first series color. */
  readonly fill?: GraphColor;
  /** Defaults to transparent. */
  readonly borderColor?: GraphColor;
  /** In graph units, so it scales with the node, like a CSS border inside a zoomed layer. Defaults to 0. */
  readonly borderWidth?: number;
  /** Dash and gap lengths of the border, in graph units, for a dashed or dotted outline. Solid when unset. */
  readonly borderDash?: readonly [number, number];
  /** Multiplies the fill and border alpha. Defaults to 1. */
  readonly opacity?: number;
  /** A ring drawn outside the node in CSS pixels, for focus and selection. Defaults to none. */
  readonly ring?: { readonly color: GraphColor; readonly width?: number; readonly gap?: number };
  /** Drawn first, under every edge and node. Lower layers draw first. Defaults to 0. */
  readonly layer?: number;
}

/** How an edge is drawn. Widths and lengths are CSS pixels unless they say otherwise. */
export interface GraphEdgeStyle {
  /** Defaults to the theme's axis color at half alpha. */
  readonly color?: GraphColor;
  /** CSS pixels. Defaults to 1. */
  readonly width?: number;
  /** Dash and gap lengths in CSS pixels. Solid when unset. */
  readonly dash?: readonly [number, number];
  /** Arrowheads. Defaults to `"none"`. */
  readonly arrow?: "none" | "end" | "start" | "both";
  /** Arrowhead length in CSS pixels; its half-width is 0.55 of it. Defaults to 9. */
  readonly arrowSize?: number;
  /**
   * How far the middle of the edge bows away from the straight line, as a fraction of its length
   * (positive bows to the left of the direction of travel). `"auto"` (the default) bows an edge only
   * when an edge also runs the other way between the same two nodes, so both directions are visible.
   */
  readonly curvature?: number | "auto";
  /** Room left between the edge's ends and the node outlines, in CSS pixels. Defaults to 2. */
  readonly gap?: number;
  /**
   * A dashed line drawn over the edge that moves along it, to show something flowing. Paused when
   * the user prefers reduced motion.
   */
  readonly flow?: {
    /** `"dash"` (the default) moves a dash pattern; `"dot"` moves round dots `width` across, `dash[0] + dash[1]` apart. */
    readonly shape?: "dash" | "dot";
    readonly color?: GraphColor;
    readonly width?: number;
    readonly dash?: readonly [number, number];
    /** CSS pixels per second along the edge's direction. Defaults to 40. */
    readonly speed?: number;
  };
  /** Multiplies the alpha of the line, arrows, and flow. Defaults to 1. */
  readonly opacity?: number;
  /** Whether the pointer can hover or click it. Defaults to true when `onEdgeClick` or `onEdgeHover` is set. */
  readonly pickable?: boolean;
}

/** The default edge label: a rounded box with text, at the middle of the edge. Sizes are graph units. */
export interface GraphEdgeLabelStyle {
  /** A CSS font; its size is in graph units. Defaults to the theme's axis font. */
  readonly font?: string;
  readonly color?: GraphColor;
  readonly background?: GraphColor;
  readonly borderColor?: GraphColor;
  readonly borderWidth?: number;
  readonly paddingX?: number;
  readonly paddingY?: number;
  readonly radius?: number;
  /** Moves the label away from the edge along its normal, toward the side it bows to. Defaults to 0. */
  readonly offset?: number;
}

/** Where a node is on screen, for a node renderer. */
export interface GraphNodeFrame {
  /** The node box on the plot, in CSS pixels from the plot's top-left corner. */
  readonly screenX: number;
  readonly screenY: number;
  readonly screenWidth: number;
  readonly screenHeight: number;
  /** The node box in graph units, as the renderer's context is set up to draw it: origin at its top-left. */
  readonly width: number;
  readonly height: number;
  /** CSS pixels per graph unit. Use it to drop detail when a node is small on screen. */
  readonly zoom: number;
  readonly shape: "circle" | "rect";
  readonly state: GraphItemState;
}

/** Where an edge label goes, for an edge label renderer. */
export interface GraphEdgeLabelFrame {
  /** The label anchor (the middle of the edge) on the plot, in CSS pixels. */
  readonly screenX: number;
  readonly screenY: number;
  /** The edge's direction at its middle, in radians, screen space (y down). */
  readonly angle: number;
  /** The side the edge bows to, as a unit vector in screen space: where a label sits clear of a reverse edge. */
  readonly normalX: number;
  readonly normalY: number;
  readonly zoom: number;
  readonly state: GraphItemState;
}

/** A node or edge under a point. */
export type GraphHit<N, E> =
  | { readonly kind: "node"; readonly node: GraphNode<N> }
  | { readonly kind: "edge"; readonly edge: GraphEdge<E> };

/** Hard limits that `setGraph` enforces before it allocates anything. */
export interface GraphLimits {
  /** Defaults to 100 000. */
  readonly maxNodes?: number;
  /** Defaults to 500 000. */
  readonly maxEdges?: number;
}

/** What `setGraph` accepted. */
export interface GraphSetResult {
  readonly nodes: number;
  readonly edges: number;
  /** Edges left out because an end is not a node, or both ends are the same node. */
  readonly skippedEdges: number;
}

/** Options for fitting the view to the graph or to some of its nodes. */
export interface GraphFitOptions {
  /** CSS pixels kept clear around the fitted nodes. Defaults to 24 on every side. */
  readonly padding?: number | { readonly top?: number; readonly right?: number; readonly bottom?: number; readonly left?: number };
  /** Only these nodes. Defaults to all of them. */
  readonly nodes?: readonly string[];
  /** Bounds for the resulting zoom (CSS pixels per graph unit). Default to the plugin's zoom limits. */
  readonly minZoom?: number;
  readonly maxZoom?: number;
  /** Animate the change over this many milliseconds. Defaults to 0 (at once). */
  readonly duration?: number;
}

/** The camera: what graph point is at the middle of the plot, and the zoom. */
export interface GraphView {
  readonly centerX: number;
  readonly centerY: number;
  /** CSS pixels per graph unit. */
  readonly zoom: number;
}

/** The background pattern, in graph units so it pans and zooms with the graph. */
export interface GraphBackground {
  readonly kind: "dots" | "grid";
  /** Distance between dots or lines, in graph units. Defaults to 24. */
  readonly gap?: number;
  /** Dot diameter or line width, in CSS pixels. Defaults to 1. */
  readonly size?: number;
  readonly color?: GraphColor;
}

/** Wording for screen readers. */
export interface GraphMessages {
  /** The graph's accessible name. Defaults to `"Graph"`. */
  readonly label?: string;
  /** How a focused node is announced. Defaults to its label. */
  readonly describeNode?: (node: GraphNode) => string;
  /** Announced when the graph gets focus with no node focused. */
  readonly instructions?: string;
}

/** Options for {@link graphPlugin}. */
export interface GraphPluginOptions<N = unknown, E = unknown> {
  readonly nodes?: readonly GraphNode<N>[];
  readonly edges?: readonly GraphEdge<E>[] | GraphEdgeArrays<E>;
  /** A style for every node, or a function of the node and its state. Merged over the defaults. */
  readonly nodeStyle?: GraphNodeStyle | ((node: GraphNode<N>, state: GraphItemState) => GraphNodeStyle);
  readonly edgeStyle?: GraphEdgeStyle | ((edge: GraphEdge<E>, state: GraphItemState) => GraphEdgeStyle);
  /**
   * Draws a node's content (text, icons, badges) over its shape, on a 2D canvas. The context is set up
   * in the node's own graph units, origin at its top-left, so content scales with zoom as the shape
   * does. Called only for nodes on screen and at least `detailMinPx` tall, and at most `maxDetails`
   * per frame. `null` draws no content; the default draws `node.label` (beside circles, inside boxes).
   */
  readonly drawNode?: ((ctx: CanvasRenderingContext2D, node: GraphNode<N>, frame: GraphNodeFrame) => void) | null;
  /**
   * Draws an edge label, with the context translated to the label anchor and scaled to graph units.
   * The default draws `edge.label` in a box styled by `edgeLabelStyle`.
   */
  readonly drawEdgeLabel?: ((ctx: CanvasRenderingContext2D, edge: GraphEdge<E>, frame: GraphEdgeLabelFrame) => void) | null;
  readonly edgeLabelStyle?: GraphEdgeLabelStyle;
  /** Font of the default node label, in graph units. Defaults to the theme's axis font. */
  readonly labelFont?: string;
  readonly labelColor?: GraphColor;
  /** Nodes smaller than this on screen (CSS pixels) get no content and no labels. Defaults to 10. */
  readonly detailMinPx?: number;
  /** At most this many node renderer calls per frame. Defaults to 2000. */
  readonly maxDetails?: number;
  /** At most this many edge labels per frame. Defaults to 1000. */
  readonly maxEdgeLabels?: number;
  /**
   * Level of detail. When more nodes than `nodes` are on screen, a frame draws the aggregate level instead: nodes
   * binned into cells a few pixels across, one dot per cell in its nodes' average color. Labels and picking are left
   * out at that level, which only shows when single nodes are too small to tell apart.
   *
   * A large graph's plain edges (4 000 or more in one straight style without arrows or flows) are kept by the engine
   * and drawn by level: `fill` is the line area (CSS pixels of on-screen length times width) a frame draws as lines,
   * the rest shown as their density; on Canvas 2D, `edges` also caps how many lines a frame draws. Other large or
   * dense graphs draw through a pair decomposition, within `edges` items and `fill`.
   *
   * Defaults to 60 000 nodes and 8 000 000 px² of kept lines on GPU engines, and 12 000 nodes, 600 000 px², and
   * 30 000 lines on Canvas 2D; `false` always draws every item.
   */
  readonly levelOfDetail?: false | { readonly nodes?: number; readonly edges?: number; readonly fill?: number };
  /** Nodes are never drawn smaller than this, in CSS pixels, so a zoomed-out graph keeps its dots. Defaults to 2. */
  readonly minNodePx?: number;
  readonly background?: GraphBackground | null;
  /** Pan by dragging the background, zoom with the wheel or a pinch, and move with the keyboard. Defaults to true. */
  readonly navigation?: boolean;
  /** Zoom limits, CSS pixels per graph unit. Default to 0.02 and 8. */
  readonly minZoom?: number;
  readonly maxZoom?: number;
  /** Fit the view to the graph when it is first set. Defaults to true; options are passed to `fit`. */
  readonly fitOnLoad?: boolean | GraphFitOptions;
  /** Whether nodes can be dragged, all of them or per node. Defaults to false. */
  readonly draggable?: boolean | ((node: GraphNode<N>) => boolean);
  readonly limits?: GraphLimits;
  readonly messages?: GraphMessages;
  /** A press and release without movement on a node, or Enter or Space on the focused node. */
  readonly onNodeClick?: (node: GraphNode<N>, event: MouseEvent | KeyboardEvent) => void;
  readonly onEdgeClick?: (edge: GraphEdge<E>, event: MouseEvent) => void;
  /** A click on the background. */
  readonly onBackgroundClick?: (event: MouseEvent) => void;
  readonly onNodeHover?: (node: GraphNode<N> | null) => void;
  readonly onEdgeHover?: (edge: GraphEdge<E> | null) => void;
  /** A drag moved a node; `x` and `y` are its new center. Called once, when the drag ends. */
  readonly onNodeDragEnd?: (node: GraphNode<N>, x: number, y: number) => void;
  /** The view changed: a pan, a zoom, a fit, or a resize. */
  readonly onViewChange?: (view: GraphView) => void;
  /** Keyboard focus moved to a node, or off every node. */
  readonly onNodeFocus?: (node: GraphNode<N> | null) => void;
}

/** The graph plugin's handle: install it with `plugins: [graph]`, then drive it. */
export interface GraphPlugin<N = unknown, E = unknown> extends ChartPlugin {
  /**
   * Replace the graph. Node and edge objects are read, never kept or changed, so pass new arrays freely;
   * the view, hover, focus, and selection stay on the ids that still exist. Throws a `RangeError` for
   * duplicate or empty node ids, non-finite positions, or more items than `limits` allows.
   */
  setGraph(nodes: readonly GraphNode<N>[], edges: readonly GraphEdge<E>[] | GraphEdgeArrays<E>): GraphSetResult;
  /** Move some nodes, by id, without replacing the graph. Unknown ids are ignored. */
  setPositions(positions: Readonly<Record<string, { readonly x: number; readonly y: number }>>): void;
  /** Apply the style functions again, for example after app state they read changed. */
  restyle(): void;
  /** Fit the view to the graph or to some nodes. */
  fit(options?: GraphFitOptions): void;
  /** Zoom around the plot's middle by `factor` (more than 1 zooms in). */
  zoomBy(factor: number, options?: { readonly duration?: number }): void;
  getView(): GraphView;
  setView(view: Partial<GraphView>, options?: { readonly duration?: number }): void;
  /** Select a node or edge by id (`null` clears the selection). */
  select(selection: { readonly node?: string | null; readonly edge?: string | null } | null): void;
  /** Move keyboard focus to a node, by id, and announce it (`null` clears it). */
  focusNode(id: string | null): void;
  /** The node or edge under a client point, nodes first. */
  pick(clientX: number, clientY: number): GraphHit<N, E> | null;
  /** A node's center on the plot, in CSS pixels, or `null` when it does not exist. */
  nodeToPlot(id: string): [number, number] | null;
  /** Remove the plugin's layers and listeners. The chart's own `dispose` calls it. */
  dispose(): void;
}
