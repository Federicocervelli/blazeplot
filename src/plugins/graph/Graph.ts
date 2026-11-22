import type { RgbaColor } from "../../core/types.js";
import type { ChartPluginContext } from "../../ui/PluginTypes.js";
import { rgbaCss } from "../../ui/theme.js";
import { singleChartPlugin } from "../common/OverlayUtils.js";
import { defaultEdgeLabelRenderer, defaultNodeRenderer, drawLabels } from "./labels.js";
import type { EdgeLabelRenderer, NodeRenderer, ResolvedLabelStyle } from "./labels.js";
import { buildGraphModel, isCoordinate } from "./model.js";
import { GraphIndex, OVERFLOW_EDGES, isDense } from "./spatial.js";
import type { GraphModel } from "./model.js";
import { EDGE_GEOMETRY, edgeDistanceSq, GraphPainter } from "./render.js";
import type { RenderSurface, RetainedEdges } from "./render.js";
import { buildEdgeLevels } from "./edgeLevels.js";
import { ColorCache, E_ARROW, E_COLOR, E_CURVATURE, E_DASH, E_GAP, E_HAS_FLOW, E_PICKABLE, E_WIDTH, EDGE_FLOATS, N_HEIGHT, N_LAYER, N_SHAPE, N_WIDTH, NODE_FLOATS, writeEdgeStyle, writeNodeStyle } from "./styles.js";
import type { StyleDefaults } from "./styles.js";
import type {
  GraphEdgeStyle,
  GraphFitOptions,
  GraphHit,
  GraphItemState,
  GraphNode,
  GraphNodeStyle,
  GraphPlugin,
  GraphPluginOptions,
  GraphSetResult,
  GraphView,
} from "./types.js";

/** The style of an edge whose style function returned nothing: one shared object, so one slot. */
const NO_STYLE: GraphEdgeStyle = Object.freeze({});
const IDLE: GraphItemState = Object.freeze({ hovered: false, focused: false, selected: false, dragging: false });
/** Pointer travel, in CSS pixels, before a press becomes a pan or a drag instead of a click. */
const DRAG_THRESHOLD = 4;
/** How far from a thin target the pointer may be and still hit it, in CSS pixels. */
const NODE_SLOP = 3;
const EDGE_SLOP = 6;
const KEY_PAN = 48;
const KEY_ZOOM = 1.25;
const WHEEL_ZOOM_PER_PIXEL = 0.0025;
/** A still frame slower than this (ms) makes pans move the layers instead of drawing them again. */
const EXPENSIVE_FRAME_MS = 8;
/** The overscan an expensive graph is drawn with, each side, as a fraction of the plot: 2.25 times its area. */
const OVERSCAN = 0.25;
/** During a long gesture, the moved layers are drawn again at least this often (ms), so they stay sharp. */
const GESTURE_REDRAW_MS = 300;
/** How long a pan must pause before the moved layers are drawn again, centered. */
const PAN_SETTLE_MS = 120;
/**
 * A still frame that leaves detail out for its budget is drawn with a third of it first, so it is cheap, and in
 * full this long after, unless something else is drawn first: detail arrives once the view rests, never in the
 * way of a gesture.
 */
const REFINE_MS = 150;
/** Plain edges a graph needs before they are kept by the engine and drawn by level (see `edgeLevels.ts`). */
const RETAINED_EDGES = 4000;
/** How long one slice of building an aggregate level may run between frames. */
const BUILD_SLICE_MS = 6;

type Gesture =
  | { readonly kind: "press"; readonly pointerId: number; readonly x: number; readonly y: number; readonly node: number; readonly moved: boolean }
  | { readonly kind: "pan"; readonly pointerId: number; lastX: number; lastY: number }
  | { readonly kind: "drag"; readonly pointerId: number; readonly node: number; readonly offsetX: number; readonly offsetY: number }
  | { readonly kind: "pinch"; distance: number; midX: number; midY: number };

/**
 * Create a plugin that draws a graph of nodes and edges with the chart's engine (WebGL2, Canvas 2D, or
 * the shared context): every node shape in one instanced draw, every edge in another, so thousands of
 * each stay interactive. Node content and edge labels are drawn by callbacks on a 2D layer, only for
 * items large enough on screen to read. Stateful: one instance per chart.
 *
 * The plugin owns navigation (drag to pan, wheel or pinch to zoom, keyboard) and keeps one zoom for
 * both axes, so create the chart without axes or grid and without `interactionsPlugin`.
 *
 * @experimental May change in a minor release before it is promoted to stable. See docs/stability.md.
 */
export function graphPlugin<N = unknown, E = unknown>(options: GraphPluginOptions<N, E> = {}): GraphPlugin<N, E> {
  let chart: ChartPluginContext | null = null;
  let surface: RenderSurface | null = null;
  let shapeCanvas: HTMLCanvasElement | null = null;
  /** The moving flows' layer, made the first time a frame has flows: animation frames redraw only it. */
  let flowSurface: RenderSurface | null = null;
  let flowCanvas: HTMLCanvasElement | null = null;
  /** Whether the still layers (shapes, labels) must be drawn again; animation-only frames leave it false. */
  let staticDirty = true;
  /** A pan or zoom is waiting: the still layers may only need moving and scaling (see `transformLayers`). */
  let viewPending = false;
  /**
   * The view the still layers were last drawn at (and when), the overscan margins they were drawn with (CSS
   * pixels each side), how long that frame took, and the CSS transform a pan or zoom has put on them since:
   * `scale` around the plot's middle, then `shift`.
   */
  const drawn = { centerX: 0, centerY: 0, zoom: 0, marginX: 0, marginY: 0, ms: 0, scale: 1, shiftX: 0, shiftY: 0, width: 0, height: 0, at: 0 };
  /** Redraws the still layers once a pan has paused, so they are centered again. */
  let settleTimer: ReturnType<typeof setTimeout> | undefined;
  let refineTimer: ReturnType<typeof setTimeout> | undefined;
  /** The next still frame draws with its full budget (see `REFINE_MS`). */
  let fullBudget = false;
  /** Whether still frames cost enough to draw the layers with a margin and follow pans by moving them (see `render`). */
  let expensiveLayers = false;
  /**
   * The view and layer size of the last still frame that left nothing out for its budget. A frame of the same view
   * (a hover, a selection, a restyle) draws with the full budget too, so it shows the same detail instead of
   * dropping to the coarse budget of a moving view and refining again: that would blink.
   */
  const fine = { centerX: NaN, centerY: NaN, zoom: NaN, width: 0, height: 0 };
  let labelCanvas: HTMLCanvasElement | null = null;
  let labelContext: CanvasRenderingContext2D | null = null;
  let live: HTMLElement | null = null;
  const disposers: Array<() => void> = [];
  let disposed = false;
  let frameId = 0;

  let model: GraphModel<N, E> = buildGraphModel<N, E>(options.nodes ?? [], options.edges ?? [], options.limits);
  let nodeStyles = new Float32Array(0);
  /**
   * Edge styles as a table of records, one per distinct style object a style function returned (or one for a
   * plain style), and each edge's slot in it: millions of edges sharing a few styles cost a few records.
   */
  let edgeStyles = new Float32Array(EDGE_FLOATS * 16);
  let edgeSlotCount = 0;
  let edgeSlot = new Uint32Array(0);
  /** Slots by the style object written there, for this styling pass. */
  let slotOfStyle = new Map<GraphEdgeStyle, number>();
  /** Shared slots by a hash of their style record, so equal styles from different objects share one. */
  let slotsByHash = new Map<number, number[]>();
  const styleScratch = new Float32Array(EDGE_FLOATS);
  /** Edges restyled one by one (hover, selection) whose style is their own: each reuses its private slot. */
  let privateSlot = new Map<number, number>();
  let order = new Uint32Array(0);
  let halfW = new Float32Array(0);
  let halfH = new Float32Array(0);
  /** Grids for picking and for drawing what is on screen, and the zoomed-out aggregates. */
  const spatial = new GraphIndex();
  const painter = new GraphPainter();
  // Colors resolve against an element inside the chart root, so `var()` tokens scoped to the chart apply.
  const colors = new ColorCache(() => live ?? undefined);
  let defaults: StyleDefaults = { nodeFill: [0.4, 0.6, 1, 1], edgeColor: [0.6, 0.6, 0.6, 0.5] };
  let labelStyle: ResolvedLabelStyle | null = null;
  let background: { kind: "dots" | "grid"; gap: number; size: number; color: RgbaColor } | null = null;

  const view = { centerX: 0, centerY: 0, zoom: 1 };
  const minZoom = positive(options.minZoom, 0.02);
  const maxZoom = Math.max(minZoom, positive(options.maxZoom, 8));
  let fitted = false;
  /** A view change in progress; its clock starts at its first frame's timestamp, so it reads one clock only. */
  let animation: { from: GraphView; to: GraphView; start: number | null; duration: number } | null = null;
  let applyingView = false;

  let hoveredNode = -1;
  let hoveredEdge = -1;
  let focusedNode = -1;
  let selectedNode = -1;
  let selectedEdge = -1;
  let draggingNode = -1;
  /** The dragged node, drawn on the overlay with its edges while the still layer leaves them out, and those edges. */
  let lifted = -1;
  let liftedEdges: Uint32Array | null = null;
  let gesture: Gesture | null = null;
  const pointers = new Map<number, { x: number; y: number }>();
  let cursor = "";
  let restoreCursor: (() => void) | null = null;
  let reducedMotion = false;

  const edgesPickable = Boolean(options.onEdgeClick || options.onEdgeHover);
  const drawNode: NodeRenderer<N> | null = options.drawNode === null ? null : (options.drawNode ?? defaultNodeRenderer<N>(() => labelStyle!));
  const drawEdgeLabel: EdgeLabelRenderer<E> | null = options.drawEdgeLabel === null ? null : (options.drawEdgeLabel ?? defaultEdgeLabelRenderer<E>(() => labelStyle!));

  const plugin: GraphPlugin<N, E> = {
    install(ctx) {
      chart = ctx;
      disposed = false;
      const doc = ctx.dom.document;
      shapeCanvas = overlayCanvas(doc, "blazeplot-graph-shapes", 4);
      labelCanvas = overlayCanvas(doc, "blazeplot-graph-labels", 6);
      labelContext = labelCanvas.getContext("2d");
      surface = ctx.unstable.createRenderSurface(shapeCanvas);
      surface.setLossListener((state) => {
        if (state === "restored") scheduleRender();
      });
      disposers.push(ctx.dom.mount("plot", shapeCanvas), ctx.dom.mount("plot", labelCanvas));

      live = ctx.dom.create("div");
      live.className = "blazeplot-visually-hidden";
      live.setAttribute("aria-live", "polite");
      live.setAttribute("aria-atomic", "true");
      disposers.push(ctx.dom.mount("root", live));
      // Keyboard input goes to the chart root, which is focusable once a chart has plugins (the plot canvas is
      // decorative and hidden from assistive technology, so it must not take focus).
      disposers.push(ctx.dom.decorate("root", { attributes: { tabindex: "0", "aria-roledescription": "graph", "aria-label": options.messages?.label ?? "Graph" } }));
      if (options.navigation !== false) disposers.push(ctx.dom.decorate("plot", { style: { touchAction: "none" } }));

      const media = ctx.dom.view.matchMedia?.("(prefers-reduced-motion: reduce)");
      reducedMotion = media?.matches === true;
      if (media) {
        const onChange = (event: MediaQueryListEvent): void => {
          reducedMotion = event.matches;
          scheduleRender();
        };
        media.addEventListener?.("change", onChange);
        disposers.push(() => media.removeEventListener?.("change", onChange));
      }

      disposers.push(
        ctx.dom.listen("plot", "pointerdown", onPointerDown),
        ctx.dom.listen("plot", "pointermove", onPointerMove),
        ctx.dom.listen("plot", "pointerup", onPointerUp),
        ctx.dom.listen("plot", "pointercancel", onPointerCancel),
        ctx.dom.listen("plot", "pointerleave", onPointerLeave),
        ctx.dom.listen("plot", "wheel", onWheel, { passive: false }),
        ctx.dom.listen("plot", "dblclick", onDoubleClick),
        ctx.dom.listen("root", "keydown", onKeyDown),
        ctx.dom.listen("root", "focus", onFocus),
        ctx.events.subscribe("viewportchange", (event) => {
          if (!applyingView && event.source !== "fit") adoptChartViewport();
        }),
      );

      resolveTheme();
      restyleAll();
      fitOnLoad();
      warmIncidence();
      scheduleRender();
      return {
        dispose: () => plugin.dispose(),
        onResize: () => {
          pushView("api");
          scheduleRender();
          options.onViewChange?.(plugin.getView());
        },
        onThemeChange: () => {
          colors.clear();
          resolveTheme();
          restyleAll();
          scheduleRender();
        },
        onContextRestored: scheduleRender,
      };
    },

    setGraph(nodes, edges) {
      const next = buildGraphModel<N, E>(nodes, edges, options.limits);
      const keep = (index: number, from: GraphModel<N, E>, kind: "node" | "edge"): number => {
        if (index < 0) return -1;
        if (kind === "edge") return index < from.edgeCount ? next.edgeIndexOf(from.edgeIdOf(index)) : -1;
        const id = from.nodes[index]?.id;
        const found = id === undefined ? undefined : next.nodeIndex.get(id);
        return found ?? -1;
      };
      const previous = model;
      hoveredNode = keep(hoveredNode, previous, "node");
      focusedNode = keep(focusedNode, previous, "node");
      selectedNode = keep(selectedNode, previous, "node");
      hoveredEdge = keep(hoveredEdge, previous, "edge");
      selectedEdge = keep(selectedEdge, previous, "edge");
      // A drag in progress keeps the node under the pointer, wherever the new graph puts it.
      if (draggingNode >= 0) {
        const kept = keep(draggingNode, previous, "node");
        if (kept >= 0) {
          next.x[kept] = previous.x[draggingNode]!;
          next.y[kept] = previous.y[draggingNode]!;
        }
        draggingNode = kept;
        if (kept < 0) gesture = null;
        else if (gesture?.kind === "drag") gesture = { ...gesture, node: kept };
      }
      model = next;
      spatial.invalidatePositions();
      warmIncidence();
      if (lifted >= 0) lift(draggingNode);
      restyleAll();
      fitOnLoad();
      scheduleRender();
      return { nodes: next.nodes.length, edges: next.edgeCount, skippedEdges: next.skippedEdges } satisfies GraphSetResult;
    },

    setPositions(positions) {
      let changed = false;
      for (const [id, point] of Object.entries(positions)) {
        const index = model.nodeIndex.get(id);
        if (index === undefined || index === draggingNode) continue;
        if (!isCoordinate(point?.x) || !isCoordinate(point?.y)) throw new RangeError(`graph: the position of "${id}" is not a finite number.`);
        model.x[index] = point.x;
        model.y[index] = point.y;
        changed = true;
      }
      if (!changed) return;
      spatial.invalidatePositions();
      // The levels are measured where edges are: built again.
      retainedStale = true;
      scheduleRender();
    },

    restyle() {
      restyleAll();
      scheduleRender();
    },

    fit(fitOptions = {}) {
      const target = fitView(fitOptions);
      if (target) setViewTo(target, fitOptions.duration ?? 0, "fit");
    },

    zoomBy(factor, zoomOptions = {}) {
      if (!(factor > 0) || !Number.isFinite(factor)) return;
      setViewTo({ ...plugin.getView(), zoom: clampZoom(view.zoom * factor) }, zoomOptions.duration ?? 0, "user");
    },

    getView() {
      return { centerX: view.centerX, centerY: view.centerY, zoom: view.zoom };
    },

    setView(next, viewOptions = {}) {
      const target = {
        centerX: isCoordinate(next.centerX) ? next.centerX : view.centerX,
        centerY: isCoordinate(next.centerY) ? next.centerY : view.centerY,
        zoom: next.zoom !== undefined && next.zoom > 0 && Number.isFinite(next.zoom) ? clampZoom(next.zoom) : view.zoom,
      };
      setViewTo(target, viewOptions.duration ?? 0, "api");
    },

    select(selection) {
      const node = selection?.node ? (model.nodeIndex.get(selection.node) ?? -1) : -1;
      const edge = selection?.edge ? model.edgeIndexOf(selection.edge) : -1;
      const before = [selectedNode, selectedEdge] as const;
      selectedNode = node;
      selectedEdge = edge;
      restyleNodes(before[0], node);
      restyleEdges(before[1], edge);
      scheduleRender();
    },

    focusNode(id) {
      setFocus(id === null ? -1 : (model.nodeIndex.get(id) ?? -1), true);
    },

    pick(clientX, clientY) {
      if (!chart) return null;
      const [px, py] = chart.coords.clientToPlot(clientX, clientY);
      return hitAt(px, py);
    },

    nodeToPlot(id) {
      const index = model.nodeIndex.get(id);
      if (index === undefined || !chart) return null;
      const { width, height } = plotSize();
      return [width / 2 + (model.x[index]! - view.centerX) * view.zoom, height / 2 + (model.y[index]! - view.centerY) * view.zoom];
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      if (frameId !== 0) chart?.dom.view.cancelAnimationFrame(frameId);
      frameId = 0;
      clearTimeout(settleTimer);
      clearTimeout(refineTimer);
      clearTimeout(buildTimer);
      cancelWarm();
      restoreCursor?.();
      restoreCursor = null;
      for (const dispose of disposers.splice(0).reverse()) dispose();
      dropRetained();
      retainedStale = true;
      surface?.dispose();
      surface = null;
      shapeCanvas = null;
      flowSurface?.dispose();
      flowSurface = null;
      flowCanvas = null;
      labelCanvas = null;
      labelContext = null;
      live = null;
      chart = null;
    },
  };

  // --- Styles ----------------------------------------------------------------------------------

  function stateOfNode(index: number): GraphItemState {
    const hovered = index === hoveredNode;
    const focused = index === focusedNode;
    const selected = index === selectedNode;
    const dragging = index === draggingNode;
    return hovered || focused || selected || dragging ? { hovered, focused, selected, dragging } : IDLE;
  }

  function stateOfEdge(index: number): GraphItemState {
    const hovered = index === hoveredEdge;
    const selected = index === selectedEdge;
    return hovered || selected ? { hovered, focused: false, selected, dragging: false } : IDLE;
  }

  function nodeStyleOf(index: number): GraphNodeStyle {
    const style = options.nodeStyle;
    if (typeof style !== "function") return style ?? {};
    try {
      return style(model.nodes[index]!, stateOfNode(index)) ?? {};
    } catch (error) {
      console.error("BlazePlot graph: nodeStyle threw.", error);
      return {};
    }
  }

  function edgeStyleOf(index: number): GraphEdgeStyle {
    const style = options.edgeStyle;
    if (typeof style !== "function") return style ?? NO_STYLE;
    try {
      return style(model.edgeView(index), stateOfEdge(index)) ?? NO_STYLE;
    } catch (error) {
      console.error("BlazePlot graph: edgeStyle threw.", error);
      return NO_STYLE;
    }
  }

  /**
   * Give edge `index` its style's slot: the slot already holding that style object, else a new one (for a single
   * edge restyled on its own, the private slot it had before).
   */
  function writeEdge(index: number, single: boolean): void {
    const style = edgeStyleOf(index);
    let slot = slotOfStyle.get(style);
    if (slot === undefined) {
      if (!single) {
        // A style function that returns a new object per edge: equal styles still share one slot, so a large graph
        // finds its common style (see `ensureRetained`).
        writeEdgeStyle(styleScratch, 0, style, colors, defaults, edgesPickable);
        slot = slotOfContent(styleScratch);
        slotOfStyle.set(style, slot);
        edgeSlot[index] = slot;
        return;
      }
      slot = privateSlot.get(index);
      if (slot === undefined) {
        slot = growSlots();
        privateSlot.set(index, slot);
      }
      writeEdgeStyle(edgeStyles, slot * EDGE_FLOATS, style, colors, defaults, edgesPickable);
      // A private slot is not shared: another edge returning this object gets its own.
    }
    edgeSlot[index] = slot;
  }

  /** A new slot at the end of `edgeStyles`, grown as needed. */
  function growSlots(): number {
    const slot = edgeSlotCount++;
    if (edgeSlotCount * EDGE_FLOATS > edgeStyles.length) {
      const grown = new Float32Array(edgeStyles.length * 2);
      grown.set(edgeStyles);
      edgeStyles = grown;
    }
    return slot;
  }

  /** The shared slot holding exactly the style record `record`, made when there is none (a hash, then an exact compare). */
  function slotOfContent(record: Float32Array): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < EDGE_FLOATS; i++) {
      // Every NaN (an "auto" curvature) hashes alike.
      const v = record[i]!;
      hash = Math.imul(hash ^ (Number.isNaN(v) ? 0x7fc00000 : Math.round(v * 65536) | 0), 0x01000193);
    }
    const bucket = slotsByHash.get(hash);
    if (bucket) {
      for (const slot of bucket) {
        const o = slot * EDGE_FLOATS;
        let same = true;
        for (let i = 0; i < EDGE_FLOATS && same; i++) {
          const a = edgeStyles[o + i]!;
          const b = record[i]!;
          same = a === b || (Number.isNaN(a) && Number.isNaN(b));
        }
        if (same) return slot;
      }
    }
    const slot = growSlots();
    edgeStyles.set(record, slot * EDGE_FLOATS);
    if (bucket) bucket.push(slot);
    else slotsByHash.set(hash, [slot]);
    return slot;
  }

  function writeNode(index: number): void {
    writeNodeStyle(nodeStyles, index * NODE_FLOATS, nodeStyleOf(index), colors, defaults);
    halfW[index] = nodeStyles[index * NODE_FLOATS + N_WIDTH]! / 2;
    halfH[index] = nodeStyles[index * NODE_FLOATS + N_HEIGHT]! / 2;
  }

  function restyleAll(): void {
    const nodes = model.nodes.length;
    const edges = model.edgeCount;
    if (nodeStyles.length !== nodes * NODE_FLOATS) {
      nodeStyles = new Float32Array(nodes * NODE_FLOATS);
      halfW = new Float32Array(nodes);
      halfH = new Float32Array(nodes);
    }
    if (edgeSlot.length !== edges) edgeSlot = new Uint32Array(edges);
    edgeSlotCount = 0;
    slotOfStyle = new Map();
    slotsByHash = new Map();
    privateSlot = new Map();
    for (let i = 0; i < nodes; i++) writeNode(i);
    for (let i = 0; i < edges; i++) writeEdge(i, false);
    resolveDenseStyle();
    sortOrder();
    spatial.invalidateStyles();
    retainedStale = true;
  }

  /**
   * A large graph's plain edges kept by the engine (see `edgeLevels.ts`), built for the current graph, styles, and
   * positions on the next frame after any of them changes; `null` when the graph is drawn without one.
   */
  let retained: RetainedEdges | null = null;
  let retainedStale = true;
  /** The slot of the edges in `retained`, and the edges restyled one by one since it was built, drawn over it. */
  let retainedSlot = -1;

  function dropRetained(): void {
    retained?.set.dispose();
    retained = null;
  }

  /**
   * Build the kept set when stale: the most used edge style, if it is straight and plain (no arrows, flows, or
   * bowed reverse pairs) and enough edges use it, else no set. Every other edge is drawn apart, one by one.
   */
  function ensureRetained(): void {
    if (!retainedStale || !surface || !chart) return;
    retainedStale = false;
    dropRetained();
    retainedSlot = -1;
    if (model.allPairs || model.edgeCount < RETAINED_EDGES) return;
    const uses = new Uint32Array(Math.max(1, edgeSlotCount));
    for (let i = 0; i < model.edgeCount; i++) uses[edgeSlot[i]!]!++;
    let slot = 0;
    for (let k = 1; k < uses.length; k++) if (uses[k]! > uses[slot]!) slot = k;
    const o = slot * EDGE_FLOATS;
    if (edgeStyles[o + E_ARROW] !== 0 || edgeStyles[o + E_HAS_FLOW] === 1) return;
    const curvature = edgeStyles[o + E_CURVATURE]!;
    if (!Number.isNaN(curvature) && curvature !== 0) return;
    const member = new Uint8Array(model.edgeCount);
    let members = 0;
    for (let e = 0; e < model.edgeCount; e++) {
      // "auto" bows an edge that also runs the other way: drawn apart, with its bow.
      if (edgeSlot[e] !== slot || (Number.isNaN(curvature) && model.reversed[e] === 1)) continue;
      member[e] = 1;
      members++;
    }
    if (members < RETAINED_EDGES) return;
    const edges = new Uint32Array(members);
    const apart = new Uint32Array(model.edgeCount - members);
    for (let e = 0, m = 0, a = 0; e < model.edgeCount; e++) {
      if (member[e] === 1) edges[m++] = e;
      else apart[a++] = e;
    }
    const degree = new Uint32Array(model.nodes.length);
    for (let e = 0; e < model.edgeCount; e++) {
      degree[model.source[e]!]!++;
      degree[model.target[e]!]!++;
    }
    const levels = buildEdgeLevels(edges, model.source, model.target, model.x, model.y, degree);
    const ends = new Uint32Array(members * 2);
    for (let k = 0; k < members; k++) {
      const e = levels.order[k]!;
      ends[k * 2] = model.source[e]!;
      ends[k * 2 + 1] = model.target[e]!;
    }
    const points = new Float32Array(model.nodes.length * 2);
    for (let i = 0; i < model.nodes.length; i++) {
      points[i * 2] = model.x[i]! - levels.minX;
      points[i * 2 + 1] = model.y[i]! - levels.minY;
    }
    // A dragged node's edges are drawn by the overlay, from where it is now.
    if (lifted >= 0 && lifted < model.nodes.length) points[lifted * 2] = Number.NaN;
    const set = surface.createSegmentSet(points, model.nodes.length, ends, members);
    const lod = options.levelOfDetail;
    const gpu = chart.renderer.capabilities.gpu;
    const unlimited = lod === false;
    retainedSlot = slot;
    retained = {
      set,
      levels,
      color: [edgeStyles[o + E_COLOR]!, edgeStyles[o + E_COLOR + 1]!, edgeStyles[o + E_COLOR + 2]!, edgeStyles[o + E_COLOR + 3]!],
      width: edgeStyles[o + E_WIDTH]!,
      dash: edgeStyles[o + E_DASH]!,
      gap: edgeStyles[o + E_GAP]!,
      fill: unlimited ? Infinity : (lod?.fill ?? (gpu ? 8_000_000 : 600_000)),
      maxSegments: unlimited ? Infinity : gpu ? Infinity : (lod?.edges ?? 30_000),
      apart,
      member,
      geometry: edgesPickable || (drawEdgeLabel !== null && model.edgeCount > 0),
    };
  }

  /** Where node `index` is in the kept set: a hole while it is lifted (its edges are the overlay's), else its position. */
  function syncRetainedPoint(index: number): void {
    if (!retained || index < 0 || index >= model.nodes.length) return;
    const point = index === lifted ? [Number.NaN, Number.NaN] : [model.x[index]! - retained.levels.minX, model.y[index]! - retained.levels.minY];
    retained.set.setPoints(Float32Array.from(point), index);
  }

  /** The edges drawn over the kept set this frame: those never in it, and members restyled one by one since. */
  function retainedApart(): Uint32Array {
    if (!retained) return new Uint32Array(0);
    const extra: number[] = [];
    for (const e of privateSlot.keys()) if (e < model.edgeCount && retained.member[e] === 1 && edgeSlot[e] !== retainedSlot) extra.push(e);
    if (extra.length === 0) return retained.apart;
    const out = new Uint32Array(retained.apart.length + extra.length);
    out.set(retained.apart);
    out.set(extra, retained.apart.length);
    return out;
  }

  /** A dense graph's common edge style record, and its edges styled apart from it. */
  let denseSlot = 0;
  let styledEdges: Uint32Array | null = null;

  /**
   * For "every pair": the plain `edgeStyle` object (a function is not called for implicit edges). For listed
   * edges: the most used style record, and the edges with another one, which a dense graph draws one by one.
   */
  function resolveDenseStyle(): void {
    styledEdges = null;
    if (model.allPairs) {
      const style = typeof options.edgeStyle === "object" && options.edgeStyle ? options.edgeStyle : NO_STYLE;
      denseSlot = edgeSlotCount++;
      if (edgeSlotCount * EDGE_FLOATS > edgeStyles.length) {
        const grown = new Float32Array(edgeSlotCount * EDGE_FLOATS * 2);
        grown.set(edgeStyles);
        edgeStyles = grown;
      }
      writeEdgeStyle(edgeStyles, denseSlot * EDGE_FLOATS, style, colors, defaults, false);
      return;
    }
    // A small sparse graph draws every edge with its own style: nothing to resolve. A large one draws views its
    // edges overflow through the pair hierarchy, which counts the common style's edges only.
    spatial.keep = null;
    if (!isDense(model) && model.edgeCount <= OVERFLOW_EDGES) return;
    const uses = new Uint32Array(Math.max(1, edgeSlotCount));
    for (let i = 0; i < model.edgeCount; i++) uses[edgeSlot[i]!]!++;
    denseSlot = 0;
    for (let k = 1; k < uses.length; k++) if (uses[k]! > uses[denseSlot]!) denseSlot = k;
    const apart: number[] = [];
    for (let i = 0; i < model.edgeCount && apart.length < 1_000_000; i++) if (edgeSlot[i] !== denseSlot) apart.push(i);
    styledEdges = Uint32Array.from(apart);
    let keep: Uint8Array | null = null;
    if (apart.length > 0 && apart.length < 1_000_000) {
      keep = new Uint8Array(model.edgeCount).fill(1);
      for (const e of apart) keep[e] = 0;
    }
    spatial.keep = keep;
  }

  /** Restyle the nodes whose state changed (an index of -1 is ignored). A layer change re-sorts. */
  function restyleNodes(...indices: number[]): void {
    let resort = false;
    for (const index of indices) {
      if (index < 0 || index >= model.nodes.length) continue;
      const layer = nodeStyles[index * NODE_FLOATS + N_LAYER];
      const w = halfW[index];
      const h = halfH[index];
      writeNode(index);
      if (nodeStyles[index * NODE_FLOATS + N_LAYER] !== layer) resort = true;
      if (halfW[index] !== w || halfH[index] !== h) spatial.invalidateStyles();
    }
    if (resort) sortOrder();
  }

  function restyleEdges(...indices: number[]): void {
    for (const index of indices) {
      if (index < 0 || index >= model.edgeCount) continue;
      writeEdge(index, true);
    }
  }

  /** Draw order: by layer, then input order. A layer-free graph keeps input order without sorting. */
  function sortOrder(): void {
    const count = model.nodes.length;
    if (order.length !== count) order = new Uint32Array(count);
    let layered = false;
    for (let i = 0; i < count; i++) {
      order[i] = i;
      if (nodeStyles[i * NODE_FLOATS + N_LAYER] !== 0) layered = true;
    }
    if (!layered) return;
    const sorted = Array.from(order).sort((a, b) => nodeStyles[a * NODE_FLOATS + N_LAYER]! - nodeStyles[b * NODE_FLOATS + N_LAYER]! || a - b);
    order.set(sorted);
  }

  function resolveTheme(): void {
    if (!chart) return;
    const theme = chart.theme;
    const axis = colors.resolve(theme.axisColor, [0.6, 0.6, 0.6, 1]);
    defaults = { nodeFill: theme.seriesColors[0] ?? [0.4, 0.6, 1, 1], edgeColor: [axis[0], axis[1], axis[2], axis[3] * 0.5] };
    const edge = options.edgeLabelStyle ?? {};
    const css = (color: string | RgbaColor | undefined, fallback: string): string => (color === undefined ? fallback : typeof color === "string" ? color : rgbaCss(color));
    labelStyle = {
      labelFont: options.labelFont ?? theme.axisFont,
      labelColor: css(options.labelColor, typeof theme.axisColor === "string" ? theme.axisColor : rgbaCss(axis)),
      edge: {
        font: edge.font ?? theme.axisFont,
        color: css(edge.color, theme.tooltipTextColor),
        background: css(edge.background, theme.tooltipBackgroundColor),
        borderColor: css(edge.borderColor, "transparent"),
        borderWidth: positive(edge.borderWidth, 0, true),
        paddingX: positive(edge.paddingX, 6, true),
        paddingY: positive(edge.paddingY, 3, true),
        radius: positive(edge.radius, 4, true),
        offset: positive(edge.offset, 0, true),
      },
    };
    const bg = options.background;
    background = bg
      ? { kind: bg.kind, gap: positive(bg.gap, 24), size: positive(bg.size, 1), color: colors.resolve(bg.color, [axis[0], axis[1], axis[2], axis[3] * 0.35]) }
      : null;
  }

  // --- View ------------------------------------------------------------------------------------

  function plotSize(): { width: number; height: number } {
    const rect = chart?.layout.plotRect();
    return { width: Math.max(0, rect?.width ?? 0), height: Math.max(0, rect?.height ?? 0) };
  }

  function clampZoom(zoom: number): number {
    return Math.min(maxZoom, Math.max(minZoom, zoom));
  }

  /** Mirror the view into the chart viewport (graph y down is data y up), so other plugins and exports agree. */
  function pushView(source: "user" | "fit" | "api"): void {
    if (!chart) return;
    const { width, height } = plotSize();
    if (width <= 0 || height <= 0) return;
    const halfX = width / 2 / view.zoom;
    const halfY = height / 2 / view.zoom;
    applyingView = true;
    try {
      chart.viewport.set({ xMin: view.centerX - halfX, xMax: view.centerX + halfX, yMin: -(view.centerY + halfY), yMax: -(view.centerY - halfY) }, undefined, { source, pauseFollow: false });
    } finally {
      applyingView = false;
    }
  }

  /** Someone else moved the chart viewport: take its middle, and the zoom that shows all of it. */
  function adoptChartViewport(): void {
    if (!chart) return;
    const { width, height } = plotSize();
    const v = chart.viewport.get();
    const spanX = v.xMax - v.xMin;
    const spanY = v.yMax - v.yMin;
    if (!(width > 0 && height > 0 && spanX > 0 && spanY > 0)) return;
    view.centerX = (v.xMin + v.xMax) / 2;
    view.centerY = -(v.yMin + v.yMax) / 2;
    view.zoom = clampZoom(Math.min(width / spanX, height / spanY));
    scheduleRender();
  }

  function setViewTo(target: GraphView, duration: number, source: "user" | "fit" | "api"): void {
    if (duration > 0 && !reducedMotion && chart) {
      animation = { from: plugin.getView(), to: target, start: null, duration };
      scheduleRender();
      return;
    }
    animation = null;
    view.centerX = target.centerX;
    view.centerY = target.centerY;
    view.zoom = target.zoom;
    pushView(source);
    scheduleRender();
    options.onViewChange?.(plugin.getView());
  }

  function fitView(fitOptions: GraphFitOptions): GraphView | null {
    const { width, height } = plotSize();
    if (width <= 0 || height <= 0) return null;
    const ids = fitOptions.nodes;
    const indices = ids ? ids.map((id) => model.nodeIndex.get(id)).filter((i): i is number => i !== undefined) : null;
    const count = indices ? indices.length : model.nodes.length;
    if (count === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let k = 0; k < count; k++) {
      const i = indices ? indices[k]! : k;
      minX = Math.min(minX, model.x[i]! - halfW[i]!);
      maxX = Math.max(maxX, model.x[i]! + halfW[i]!);
      minY = Math.min(minY, model.y[i]! - halfH[i]!);
      maxY = Math.max(maxY, model.y[i]! + halfH[i]!);
    }
    const pad = fitOptions.padding ?? 24;
    const p = typeof pad === "number" ? { top: pad, right: pad, bottom: pad, left: pad } : { top: pad.top ?? 0, right: pad.right ?? 0, bottom: pad.bottom ?? 0, left: pad.left ?? 0 };
    const availableW = Math.max(1, width - p.left - p.right);
    const availableH = Math.max(1, height - p.top - p.bottom);
    const lo = Math.max(minZoom, fitOptions.minZoom ?? minZoom);
    const hi = Math.min(maxZoom, Math.max(lo, fitOptions.maxZoom ?? maxZoom));
    const zoom = Math.min(hi, Math.max(lo, Math.min(availableW / Math.max(maxX - minX, 1e-9), availableH / Math.max(maxY - minY, 1e-9))));
    // Center the boxes in the padded area.
    const centerX = (minX + maxX) / 2 - (p.left - p.right) / 2 / zoom;
    const centerY = (minY + maxY) / 2 - (p.top - p.bottom) / 2 / zoom;
    return { centerX, centerY, zoom };
  }

  function fitOnLoad(): void {
    if (fitted || options.fitOnLoad === false || model.nodes.length === 0 || !chart) return;
    const target = fitView(typeof options.fitOnLoad === "object" ? options.fitOnLoad : {});
    if (!target) return;
    fitted = true;
    setViewTo(target, 0, "fit");
  }

  // --- Frames ----------------------------------------------------------------------------------

  /** Schedule a frame that draws everything again: something the still layers show changed. */
  function scheduleRender(): void {
    staticDirty = true;
    requestFrame();
  }

  /** Schedule a frame; on its own (flow animation) only the flow layer is drawn again. */
  function requestFrame(): void {
    if (disposed || frameId !== 0 || !chart) return;
    frameId = chart.dom.view.requestAnimationFrame(render);
  }

  /**
   * How many nodes and edges a still frame draws one by one before it draws the aggregate level: what each engine
   * draws in a few milliseconds on a phone, unless `levelOfDetail` says otherwise (`false` never aggregates).
   */
  function detailBudget(full = true): { nodes: number; edges: number; fill: number; overdraw: number; dense: number; fieldStep: number } {
    const lod = options.levelOfDetail;
    if (lod === false) return { nodes: Infinity, edges: Infinity, fill: Infinity, overdraw: Infinity, dense: Infinity, fieldStep: 1 };
    // An engine that draws on the CPU (Canvas 2D) gets the smaller budgets.
    const cpu = chart ? !chart.renderer.capabilities.gpu : false;
    return {
      nodes: lod?.nodes ?? (cpu ? 12_000 : 60_000),
      // A frame during a gesture draws a third of the edges; the rest follow once the view rests (see `REFINE_MS`).
      edges: full ? (lod?.edges ?? (cpu ? 80_000 : 150_000)) : (lod?.edges ?? (cpu ? 25_000 : 150_000)) / 3,
      fill: full ? (lod?.fill ?? 16_000_000) : (lod?.fill ?? (cpu ? 700_000 : 2_000_000)) / 3,
      // How many times over the bands of a dense graph may cover the plot, together.
      overdraw: cpu ? 12 : 48,
      // Items (bands and single lines) of a dense graph's cut: each costs more to find than a listed edge.
      dense: Math.min(lod?.edges ?? Infinity, full ? (cpu ? 6_000 : 16_000) : cpu ? 1_200 : 2_500),
      // A dense graph's lines per pixel are sampled every CSS pixel at rest, every other one while the view moves.
      fieldStep: full ? 1 : 2,
    };
  }

  /** Lift a node (its index) onto the overlay with its edges, or put it back with -1; the still layer is drawn again. */
  function lift(index: number): void {
    // Without an overlay (no surface could be made) the node stays in the still layer, drawn again each move.
    // A drag that ends moved one node: the index takes it and its edges as moved, without a rebuild.
    if (index < 0 && lifted >= 0 && liftedEdges) spatial.moveNode(lifted, liftedEdges, model.x, model.y);
    const previous = lifted;
    lifted = index >= 0 && ensureFlowSurface() ? index : -1;
    // Kept out of the pair hierarchy across rebuilds too, which `detach` alone does not survive.
    spatial.held = lifted;
    syncRetainedPoint(previous);
    syncRetainedPoint(lifted);
    if (lifted < 0) {
      liftedEdges = null;
    } else {
      // The node leaves the pair hierarchy, so the still layer stops drawing its edges where it was. A dense
      // graph draws them as a star from where it is (its edges styled apart one by one); any other graph lifts
      // every edge of it, one by one.
      spatial.detach(index, model.x, model.y);
      const all = edgesOf(index);
      liftedEdges = spatial.dense ? all.filter((e) => edgeSlot[e] !== denseSlot) : all;
    }
    scheduleRender();
  }

  type IdleView = Window & { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number; cancelIdleCallback?: (handle: number) => void };
  let warmHandle: { idle: number } | { timer: ReturnType<typeof setTimeout> } | undefined;

  /** Cancel a pending `warmIncidence`, so a disposed graph is not kept alive by it. */
  function cancelWarm(): void {
    if (!warmHandle) return;
    if ("idle" in warmHandle) (chart?.dom.view as IdleView | undefined)?.cancelIdleCallback?.(warmHandle.idle);
    else clearTimeout(warmHandle.timer);
    warmHandle = undefined;
  }

  /**
   * Build the model's incidence index and the drag overlay while the browser is idle, so the first drag finds a
   * node's edges at once instead of walking every edge, and does not wait for a new context.
   */
  function warmIncidence(): void {
    if (!options.draggable) return;
    const view = chart?.dom.view as IdleView | undefined;
    const target = model;
    const run = (): void => {
      warmHandle = undefined;
      if (disposed || target !== model) return;
      target.edgesAt(0);
      // The overlay a drag draws on: a new context is slow to make, so not on the first drag.
      ensureFlowSurface();
    };
    if (warmHandle !== undefined) return;
    warmHandle = view?.requestIdleCallback ? { idle: view.requestIdleCallback(run, { timeout: 2000 }) } : { timer: setTimeout(run, 300) };
  }

  /** The edges of a node (the model's incidence index, built on the first drag). */
  function edgesOf(index: number): Uint32Array {
    return model.edgesAt(index);
  }

  /** The flow layer, between the shapes and the labels, on the chart's engine. */
  function ensureFlowSurface(): RenderSurface | null {
    if (flowSurface || !chart) return flowSurface;
    flowCanvas = overlayCanvas(chart.dom.document, "blazeplot-graph-flows", 5);
    try {
      flowSurface = chart.unstable.createRenderSurface(flowCanvas);
    } catch (error) {
      console.error("BlazePlot graph: could not create the flow layer; flows are not drawn.", error);
      flowCanvas = null;
      return null;
    }
    flowSurface.setLossListener((state) => {
      if (state === "restored") scheduleRender();
    });
    disposers.push(chart.dom.mount("plot", flowCanvas));
    return flowSurface;
  }

  function render(now: number): void {
    frameId = 0;
    if (!chart || !surface || !shapeCanvas || !labelCanvas || surface.isLost) return;
    const { width, height } = plotSize();
    if (width <= 0 || height <= 0) return;
    if (!fitted) fitOnLoad();
    if (animation) staticDirty = true;
    stepAnimation(now);
    if (viewPending && !staticDirty) {
      if (transformLayers(now, width, height)) return;
      // The view moved past what the layers can follow: draw them again.
      staticDirty = true;
    }
    viewPending = false;
    const dpr = Math.max(1, chart.dom.view.devicePixelRatio || 1);
    // The margin only pays when a frame is expensive; a cheap graph is drawn at the plot's size.
    const expensive = expensiveLayers;
    const marginX = staticDirty ? (expensive ? Math.round(width * OVERSCAN) : 0) : drawn.marginX;
    const marginY = staticDirty ? (expensive ? Math.round(height * OVERSCAN) : 0) : drawn.marginY;
    const layerW = width + marginX * 2;
    const layerH = height + marginY * 2;
    const deviceW = Math.max(1, Math.round(layerW * dpr));
    const deviceH = Math.max(1, Math.round(layerH * dpr));
    if (marginX !== drawn.marginX || marginY !== drawn.marginY) staticDirty = true;
    for (const canvas of [shapeCanvas, labelCanvas, flowCanvas]) {
      if (!canvas) continue;
      if (canvas.width !== deviceW || canvas.height !== deviceH) staticDirty = true;
      if (canvas.width !== deviceW) canvas.width = deviceW;
      if (canvas.height !== deviceH) canvas.height = deviceH;
    }
    ensureRetained();
    const still = view.centerX === fine.centerX && view.centerY === fine.centerY && view.zoom === fine.zoom && layerW === fine.width && layerH === fine.height;
    const useFull = fullBudget || still;
    const input = {
      model,
      nodeStyles,
      edgeStyles,
      edgeSlot,
      order,
      centerX: view.centerX,
      centerY: view.centerY,
      zoom: view.zoom,
      width: layerW,
      height: layerH,
      pixelRatio: dpr,
      time: now / 1000,
      animate: !reducedMotion,
      minNodePx: positive(options.minNodePx, 2),
      background,
      lifted,
      liftedEdges,
      spatial,
      budget: detailBudget(useFull),
      denseSlot,
      styledEdges,
      // Only a GPU engine interpolates `fillTriangles` colors across a triangle (see its docs).
      gradientBands: chart.renderer.capabilities.gpu,
      retained: retained ? { ...retained, apart: retainedApart() } : null,
    };
    const full = staticDirty;
    staticDirty = false;
    lastInput = input;
    if (full) {
      spatial.ensure(model, halfW, halfH);
      clearTimeout(settleTimer);
      const started = chart.dom.view.performance?.now() ?? Date.now();
      for (const canvas of [shapeCanvas, labelCanvas, flowCanvas]) if (canvas) placeLayer(canvas, marginX, marginY, width, height);
      clearTimeout(refineTimer);
      painter.paint(surface, input);
      const coarse = !useFull && painter.clipped;
      fullBudget = false;
      if (coarse) scheduleRefine();
      else Object.assign(fine, { centerX: view.centerX, centerY: view.centerY, zoom: view.zoom, width: layerW, height: layerH });
      Object.assign(drawn, { centerX: view.centerX, centerY: view.centerY, zoom: view.zoom, marginX, marginY, scale: 1, shiftX: 0, shiftY: 0, width, height, at: now });
      // Measured after the labels too, below.
      drawnStart = started;
    }
    if (painter.needsOverlay(input) || flowSurface) {
      const flows = painter.needsOverlay(input) ? ensureFlowSurface() : flowSurface;
      if (flows && flowCanvas && !flows.isLost) {
        if (flowCanvas.width !== deviceW) flowCanvas.width = deviceW;
        if (flowCanvas.height !== deviceH) flowCanvas.height = deviceH;
        painter.paintFlows(flows, input);
      }
    }
    // Labels follow a dragged node, so a drag frame draws them again too.
    if ((full || lifted >= 0) && labelContext) {
      drawLabels({
        ctx: labelContext,
        model,
        nodes: painter.drawnNodes,
        nodeCount: painter.drawnNodeCount,
        edges: painter.drawnEdges,
        edgeCount: painter.drawnEdgeCount,
        nodeScreen: painter.nodeScreen,
        edgeScreen: painter.edgeScreen,
        nodeSize: (i) => [nodeStyles[i * NODE_FLOATS + N_WIDTH]!, nodeStyles[i * NODE_FLOATS + N_HEIGHT]!, nodeStyles[i * NODE_FLOATS + N_SHAPE] === 1],
        nodeState: stateOfNode,
        edgeState: stateOfEdge,
        drawNode,
        drawEdgeLabel,
        zoom: view.zoom,
        width: layerW,
        height: layerH,
        pixelRatio: dpr,
        detailMinPx: positive(options.detailMinPx, 10, true),
        maxDetails: Math.floor(positive(options.maxDetails, 2000, true)),
        maxEdgeLabels: Math.floor(positive(options.maxEdgeLabels, 1000, true)),
      });
    }
    if (full) {
      drawn.ms = (chart.dom.view.performance?.now() ?? Date.now()) - drawnStart;
      // With hysteresis: a frame time hovering around the threshold would add and drop the margin every frame,
      // and each change reallocates every layer's drawing buffer.
      expensiveLayers = drawn.ms > EXPENSIVE_FRAME_MS ? true : drawn.ms < EXPENSIVE_FRAME_MS / 4 ? false : expensiveLayers;
    }
    if (spatial.building) scheduleBuild();
    if (animation) scheduleRender();
    else if (painter.moving) requestFrame();
  }

  /** Draw with the full budget once the view rests and no pointer is down (see `REFINE_MS`). */
  function scheduleRefine(): void {
    clearTimeout(refineTimer);
    refineTimer = setTimeout(() => {
      if (disposed) return;
      if (pointers.size > 0) return scheduleRefine();
      fullBudget = true;
      scheduleRender();
    }, REFINE_MS);
  }

  let drawnStart = 0;
  let buildTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Advance the aggregate level being built in slices of a few milliseconds between frames, so frames keep
   * coming; draw again once it is done.
   */
  function scheduleBuild(): void {
    if (buildTimer !== undefined || disposed) return;
    buildTimer = setTimeout(() => {
      buildTimer = undefined;
      if (disposed || !chart) return;
      const clock = chart.dom.view.performance ?? Date;
      const now = (): number => clock.now();
      if (spatial.pump(now, now() + BUILD_SLICE_MS)) scheduleRender();
      else if (spatial.building) scheduleBuild();
    }, 0);
  }
  let lastInput: Parameters<GraphPainter["paint"]>[1] | null = null;

  /** Size and place a layer its margins beyond the plot on each side, untransformed, scaling around the plot's middle. */
  function placeLayer(canvas: HTMLCanvasElement, marginX: number, marginY: number, width: number, height: number): void {
    const left = `${-marginX}px`;
    const top = `${-marginY}px`;
    if (canvas.style.left !== left || canvas.style.top !== top) {
      canvas.style.inset = "";
      canvas.style.left = left;
      canvas.style.top = top;
      canvas.style.width = `calc(100% + ${marginX * 2}px)`;
      canvas.style.height = `calc(100% + ${marginY * 2}px)`;
    }
    canvas.style.transformOrigin = `${marginX + width / 2}px ${marginY + height / 2}px`;
    canvas.style.transform = "";
  }

  /**
   * Follow a pan or zoom by moving and scaling the still layers with CSS instead of drawing them again, when a
   * frame is expensive and what was drawn (with its margins) still covers the plot. Redraws are still made
   * when the gesture pauses, when the last one is older than `GESTURE_REDRAW_MS`, or when the scale has gone
   * past 2 either way, so text is never blurred for long. Returns false when a full frame is needed.
   */
  function transformLayers(now: number, width: number, height: number): boolean {
    viewPending = false;
    if (!expensiveLayers || width !== drawn.width || height !== drawn.height || drawn.zoom <= 0) return false;
    const scale = view.zoom / drawn.zoom;
    // Only a scaled layer blurs, so only a zoom is redrawn by age; a slow redraw is spaced out further, so a
    // gesture spends at most about a sixth of its time redrawing. A pan redraws when it runs out of margin.
    const stale = scale !== 1 && now - drawn.at > Math.max(GESTURE_REDRAW_MS, drawn.ms * 6);
    if (scale > 2 || scale < 0.5 || stale) return false;
    const shiftX = (drawn.centerX - view.centerX) * view.zoom;
    const shiftY = (drawn.centerY - view.centerY) * view.zoom;
    // The plot's corners on the layer, which must lie inside it: a layer point L shows at
    // P = W/2 + scale * (L - margin - W/2) + shift.
    const left = drawn.marginX + width / 2 + (-width / 2 - shiftX) / scale;
    const right = drawn.marginX + width / 2 + (width / 2 - shiftX) / scale;
    const top = drawn.marginY + height / 2 + (-height / 2 - shiftY) / scale;
    const bottom = drawn.marginY + height / 2 + (height / 2 - shiftY) / scale;
    if (left < 0 || top < 0 || right > width + drawn.marginX * 2 || bottom > height + drawn.marginY * 2) return false;
    drawn.scale = scale;
    drawn.shiftX = shiftX;
    drawn.shiftY = shiftY;
    const transform = `translate(${shiftX}px, ${shiftY}px) scale(${scale})`;
    for (const canvas of [shapeCanvas, labelCanvas, flowCanvas]) if (canvas) canvas.style.transform = transform;
    clearTimeout(settleTimer);
    // The finer cut waits for the view to rest: the frame drawn when it settles schedules it again.
    clearTimeout(refineTimer);
    settleTimer = setTimeout(scheduleRender, PAN_SETTLE_MS);
    // The flows move with their layer and keep animating at this frame's time.
    if (flowSurface && lastInput && painter.hasFlows && !flowSurface.isLost) painter.paintFlows(flowSurface, { ...lastInput, time: now / 1000 });
    if (painter.moving) requestFrame();
    return true;
  }

  function stepAnimation(now: number): void {
    if (!animation) return;
    animation.start ??= now;
    const t = Math.min(1, (now - animation.start) / animation.duration);
    const ease = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    const { from, to } = animation;
    // Zoom is interpolated geometrically, so the change feels even at every scale.
    view.zoom = from.zoom * (to.zoom / from.zoom) ** ease;
    view.centerX = from.centerX + (to.centerX - from.centerX) * ease;
    view.centerY = from.centerY + (to.centerY - from.centerY) * ease;
    if (t >= 1) {
      animation = null;
      view.centerX = to.centerX;
      view.centerY = to.centerY;
      view.zoom = to.zoom;
    }
    pushView("fit");
    options.onViewChange?.(plugin.getView());
  }

  // --- Picking ---------------------------------------------------------------------------------

  /** The node or edge at a plot point (CSS pixels), as last drawn. */
  function hitAt(px: number, py: number): GraphHit<N, E> | null {
    const node = nodeAt(px, py);
    if (node >= 0) return { kind: "node", node: model.nodes[node]! };
    const edge = edgeAt(px, py);
    return edge >= 0 ? { kind: "edge", edge: model.edgeAt(edge) } : null;
  }

  function nodeAt(px: number, py: number): number {
    if (model.nodes.length === 0) return -1;
    const { width, height } = plotSize();
    spatial.ensure(model, halfW, halfH);
    const gx = view.centerX + (px - width / 2) / view.zoom;
    const gy = view.centerY + (py - height / 2) / view.zoom;
    const minHalf = positive(options.minNodePx, 2) / 2;
    const slop = (NODE_SLOP + minHalf) / view.zoom;
    // Topmost first: the node drawn last wins, so walk candidates and keep the highest draw rank.
    let best = -1;
    let bestRank = -1;
    const rank = drawRank();
    const reach = slop + spatial.maxHalf;
    const found = spatial.nodes.query({ minX: gx - reach, minY: gy - reach, maxX: gx + reach, maxY: gy + reach }, pickQuery);
    for (let k = 0; k < found; k++) {
      const i = pickQuery.data[k]!;
      const hw = Math.max(halfW[i]!, minHalf / view.zoom) + NODE_SLOP / view.zoom;
      const hh = Math.max(halfH[i]!, minHalf / view.zoom) + NODE_SLOP / view.zoom;
      const dx = gx - model.x[i]!;
      const dy = gy - model.y[i]!;
      const inside = nodeStyles[i * NODE_FLOATS + N_SHAPE] === 0 ? dx * dx + dy * dy <= hw * hw : Math.abs(dx) <= hw && Math.abs(dy) <= hh;
      if (inside && rank[i]! > bestRank) {
        best = i;
        bestRank = rank[i]!;
      }
    }
    return best;
  }

  const pickQuery = { data: new Uint32Array(64) };

  let rankCache: Uint32Array | null = null;
  let rankOrder: Uint32Array | null = null;
  function drawRank(): Uint32Array {
    if (rankOrder === order && rankCache) return rankCache;
    rankCache = new Uint32Array(order.length);
    for (let k = 0; k < order.length; k++) rankCache[order[k]!] = k;
    rankOrder = order;
    return rankCache;
  }

  function edgeAt(plotX: number, plotY: number): number {
    const geometry = painter.edgeScreen;
    // The layers' geometry is in their own pixels: drawn with margins, then perhaps moved and scaled.
    const { width, height } = plotSize();
    const px = drawn.marginX + width / 2 + (plotX - width / 2 - drawn.shiftX) / drawn.scale;
    const py = drawn.marginY + height / 2 + (plotY - height / 2 - drawn.shiftY) / drawn.scale;
    let best = -1;
    let bestDistance = EDGE_SLOP * EDGE_SLOP;
    // Only edges drawn one by one can be picked: none while the aggregate level is drawn.
    for (let k = painter.drawnEdgeCount - 1; k >= 0; k--) {
      const i = painter.drawnEdges[k]!;
      if (edgeStyles[edgeSlot[i]! * EDGE_FLOATS + E_PICKABLE] !== 1) continue;
      const g = i * EDGE_GEOMETRY;
      if (geometry[g + 6] !== 1) continue;
      const distance = edgeDistanceSq(geometry, g, px, py);
      if (distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    }
    return best;
  }

  // --- Input -----------------------------------------------------------------------------------

  function plotPoint(event: { clientX: number; clientY: number }): [number, number] {
    return chart!.coords.clientToPlot(event.clientX, event.clientY);
  }

  function draggable(index: number): boolean {
    const option = options.draggable;
    if (!option || index < 0) return false;
    if (option === true) return true;
    try {
      return option(model.nodes[index]!);
    } catch {
      return false;
    }
  }

  function onPointerDown(event: PointerEvent): void {
    if (!chart || (event.pointerType === "mouse" && event.button !== 0)) return;
    const [px, py] = plotPoint(event);
    pointers.set(event.pointerId, { x: px, y: py });
    if (pointers.size === 2 && options.navigation !== false) {
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      gesture = { kind: "pinch", distance: Math.hypot(a.x - b.x, a.y - b.y), midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2 };
      return;
    }
    if (pointers.size > 1) return;
    const node = nodeAt(px, py);
    if ((node >= 0 && draggable(node)) || options.navigation !== false) {
      if (!chart.dom.claimPointer(event)) return;
      capture(event);
    }
    gesture = { kind: "press", pointerId: event.pointerId, x: px, y: py, node, moved: false };
  }

  function onPointerMove(event: PointerEvent): void {
    if (!chart) return;
    const [px, py] = plotPoint(event);
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: px, y: py });
    const current = gesture;
    if (current?.kind === "pinch") {
      const values = [...pointers.values()];
      if (values.length < 2) return;
      const [a, b] = values as [{ x: number; y: number }, { x: number; y: number }];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      if (current.distance > 0) zoomAround(midX, midY, distance / current.distance);
      panBy(midX - current.midX, midY - current.midY);
      current.distance = distance;
      current.midX = midX;
      current.midY = midY;
      return;
    }
    if (current?.kind === "press" && current.pointerId === event.pointerId) {
      if (Math.hypot(px - current.x, py - current.y) < DRAG_THRESHOLD) return;
      if (current.node >= 0 && draggable(current.node)) {
        const { width, height } = plotSize();
        const gx = view.centerX + (current.x - width / 2) / view.zoom;
        const gy = view.centerY + (current.y - height / 2) / view.zoom;
        draggingNode = current.node;
        gesture = { kind: "drag", pointerId: current.pointerId, node: current.node, offsetX: model.x[current.node]! - gx, offsetY: model.y[current.node]! - gy };
        restyleNodes(current.node);
        lift(current.node);
      } else if (options.navigation !== false) {
        gesture = { kind: "pan", pointerId: current.pointerId, lastX: current.x, lastY: current.y };
      } else {
        gesture = { ...current, moved: true };
        return;
      }
    }
    const active = gesture;
    if (active?.kind === "pan" && active.pointerId === event.pointerId) {
      panBy(px - active.lastX, py - active.lastY);
      active.lastX = px;
      active.lastY = py;
      setCursor("grabbing");
      return;
    }
    if (active?.kind === "drag" && active.pointerId === event.pointerId) {
      const { width, height } = plotSize();
      const gx = view.centerX + (px - width / 2) / view.zoom + active.offsetX;
      const gy = view.centerY + (py - height / 2) / view.zoom + active.offsetY;
      if (isCoordinate(gx) && isCoordinate(gy)) {
        model.x[active.node] = gx;
        model.y[active.node] = gy;
        // The grids are brought up to date when the drag ends (see `lift`): until then only this node moves.
        // Only the lifted node and its edges move: the overlay and labels are drawn again, the still layer is not.
        if (lifted >= 0) requestFrame();
        else {
          syncRetainedPoint(active.node);
          scheduleRender();
        }
      }
      setCursor("grabbing");
      return;
    }
    if (!active || active.kind === "press") hover(px, py);
  }

  function onPointerUp(event: PointerEvent): void {
    if (!chart) return;
    pointers.delete(event.pointerId);
    const current = gesture;
    if (current?.kind === "pinch") {
      if (pointers.size === 0) gesture = null;
      return;
    }
    if (!current || !("pointerId" in current) || current.pointerId !== event.pointerId) return;
    gesture = null;
    if (current.kind === "press" && !current.moved) {
      const [px, py] = plotPoint(event);
      const hit = hitAt(px, py);
      if (hit?.kind === "node") {
        const index = model.nodeIndex.get(hit.node.id)!;
        setFocus(index, false);
        options.onNodeClick?.(hit.node, event);
      } else if (hit?.kind === "edge") options.onEdgeClick?.(hit.edge, event);
      else options.onBackgroundClick?.(event);
    } else if (current.kind === "drag") {
      const node = current.node;
      draggingNode = -1;
      if (lifted < 0) spatial.moveNode(node, edgesOf(node), model.x, model.y);
      lift(-1);
      restyleNodes(node);
      scheduleRender();
      if (node < model.nodes.length) options.onNodeDragEnd?.(model.nodes[node]!, model.x[node]!, model.y[node]!);
    }
    const [px, py] = plotPoint(event);
    hover(px, py);
  }

  function onPointerCancel(event: PointerEvent): void {
    pointers.delete(event.pointerId);
    if (gesture?.kind === "drag") {
      const node = gesture.node;
      draggingNode = -1;
      if (lifted < 0) spatial.moveNode(node, edgesOf(node), model.x, model.y);
      lift(-1);
      restyleNodes(node);
      if (node < model.nodes.length) options.onNodeDragEnd?.(model.nodes[node]!, model.x[node]!, model.y[node]!);
    }
    gesture = null;
    scheduleRender();
  }

  function onPointerLeave(event: PointerEvent): void {
    if (gesture && "pointerId" in gesture && gesture.pointerId === event.pointerId && gesture.kind !== "press") return;
    setHover(-1, -1);
  }

  function capture(event: PointerEvent): void {
    try {
      (event.target as Element | null)?.setPointerCapture?.(event.pointerId);
    } catch {
      // A pointer that is already gone cannot be captured; the gesture still works without capture.
    }
  }

  function hover(px: number, py: number): void {
    const node = nodeAt(px, py);
    const edge = node >= 0 ? -1 : edgesPickable ? edgeAt(px, py) : -1;
    setHover(node, edge);
  }

  function setHover(node: number, edge: number): void {
    if (node !== hoveredNode) {
      const before = hoveredNode;
      hoveredNode = node;
      restyleNodes(before, node);
      options.onNodeHover?.(node >= 0 ? model.nodes[node]! : null);
      scheduleRender();
    }
    if (edge !== hoveredEdge) {
      const before = hoveredEdge;
      hoveredEdge = edge;
      restyleEdges(before, edge);
      options.onEdgeHover?.(edge >= 0 ? model.edgeAt(edge) : null);
      scheduleRender();
    }
    setCursorState();
  }

  function setCursorState(): void {
    if (gesture?.kind === "pan" || gesture?.kind === "drag") return setCursor("grabbing");
    if (hoveredNode >= 0) return setCursor(draggable(hoveredNode) ? "grab" : options.onNodeClick ? "pointer" : "");
    if (hoveredEdge >= 0) return setCursor(options.onEdgeClick ? "pointer" : "");
    setCursor(options.navigation === false ? "" : "grab");
  }

  function setCursor(next: string): void {
    if (next === cursor || !chart) return;
    cursor = next;
    restoreCursor?.();
    restoreCursor = next ? chart.dom.decorate("plot", { style: { cursor: next } }) : null;
  }

  function panBy(dx: number, dy: number): void {
    if (dx === 0 && dy === 0) return;
    animation = null;
    view.centerX -= dx / view.zoom;
    view.centerY -= dy / view.zoom;
    pushView("user");
    viewPending = true;
    requestFrame();
    options.onViewChange?.(plugin.getView());
  }

  /** Zoom by `factor` keeping the graph point under plot point (`px`, `py`) still. */
  function zoomAround(px: number, py: number, factor: number): void {
    const zoom = clampZoom(view.zoom * factor);
    if (zoom === view.zoom) return;
    animation = null;
    const { width, height } = plotSize();
    const gx = view.centerX + (px - width / 2) / view.zoom;
    const gy = view.centerY + (py - height / 2) / view.zoom;
    view.zoom = zoom;
    view.centerX = gx - (px - width / 2) / zoom;
    view.centerY = gy - (py - height / 2) / zoom;
    pushView("user");
    viewPending = true;
    requestFrame();
    options.onViewChange?.(plugin.getView());
  }

  function onWheel(event: WheelEvent): void {
    if (options.navigation === false || !chart) return;
    event.preventDefault();
    const [px, py] = plotPoint(event);
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
    // Trackpad pinches arrive as ctrl+wheel with small deltas; scroll without ctrl on a trackpad pans.
    if (!event.ctrlKey && event.deltaMode === 0 && Math.abs(event.deltaX) > 0 && Math.abs(event.deltaX) >= Math.abs(event.deltaY) / 2) {
      panBy(-event.deltaX, -event.deltaY);
      return;
    }
    const delta = Math.max(-400, Math.min(400, event.deltaY * scale * (event.ctrlKey ? 4 : 1)));
    zoomAround(px, py, Math.exp(-delta * WHEEL_ZOOM_PER_PIXEL));
  }

  function onDoubleClick(event: MouseEvent): void {
    if (options.navigation === false || !chart) return;
    const [px, py] = plotPoint(event);
    if (nodeAt(px, py) >= 0) return;
    zoomAround(px, py, event.shiftKey ? 0.5 : 2);
  }

  function onFocus(): void {
    if (focusedNode >= 0) announce(focusedNode);
    else if (live) live.textContent = options.messages?.instructions ?? "Arrow keys move between nodes, Enter opens one, plus and minus zoom, 0 fits the graph.";
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (!chart || event.altKey || event.metaKey || event.ctrlKey) return;
    const key = event.key;
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const direction = arrows[key];
    if (direction) {
      event.preventDefault();
      if (event.shiftKey || model.nodes.length === 0) {
        panBy(-direction[0] * KEY_PAN, -direction[1] * KEY_PAN);
        return;
      }
      setFocus(focusedNode < 0 ? nearestToCenter() : nextInDirection(focusedNode, direction[0], direction[1]), true);
      return;
    }
    if ((key === "Enter" || key === " ") && focusedNode >= 0) {
      event.preventDefault();
      options.onNodeClick?.(model.nodes[focusedNode]!, event);
      return;
    }
    if (key === "Escape" && focusedNode >= 0) {
      event.preventDefault();
      setFocus(-1, false);
      return;
    }
    if (options.navigation === false) return;
    if (key === "+" || key === "=") {
      event.preventDefault();
      plugin.zoomBy(KEY_ZOOM, { duration: 120 });
    } else if (key === "-" || key === "_") {
      event.preventDefault();
      plugin.zoomBy(1 / KEY_ZOOM, { duration: 120 });
    } else if (key === "0" || key === "Home") {
      event.preventDefault();
      plugin.fit({ ...(typeof options.fitOnLoad === "object" ? options.fitOnLoad : {}), duration: 200 });
    }
  }

  function nearestToCenter(): number {
    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < model.nodes.length; i++) {
      const d = (model.x[i]! - view.centerX) ** 2 + (model.y[i]! - view.centerY) ** 2;
      if (d < bestDistance) {
        best = i;
        bestDistance = d;
      }
    }
    return best;
  }

  /** The nearest node within 60 degrees of a direction, weighting distance off that direction twice. */
  function nextInDirection(from: number, ux: number, uy: number): number {
    let best = from;
    let bestScore = Infinity;
    const x0 = model.x[from]!;
    const y0 = model.y[from]!;
    for (let i = 0; i < model.nodes.length; i++) {
      if (i === from) continue;
      const dx = model.x[i]! - x0;
      const dy = model.y[i]! - y0;
      const along = dx * ux + dy * uy;
      if (along <= 0) continue;
      const across = Math.abs(dx * uy - dy * ux);
      if (across > along * Math.tan(Math.PI / 3)) continue;
      const score = along + across * 2;
      if (score < bestScore) {
        best = i;
        bestScore = score;
      }
    }
    return best;
  }

  function setFocus(index: number, reveal: boolean): void {
    if (index === focusedNode) {
      if (index >= 0 && reveal) announce(index);
      return;
    }
    const before = focusedNode;
    focusedNode = index;
    restyleNodes(before, index);
    scheduleRender();
    options.onNodeFocus?.(index >= 0 ? model.nodes[index]! : null);
    if (index < 0) return;
    if (reveal) {
      revealNode(index);
      announce(index);
    }
  }

  /** Pan just enough to bring a node fully on screen. */
  function revealNode(index: number): void {
    const { width, height } = plotSize();
    const margin = 24;
    const sx = width / 2 + (model.x[index]! - view.centerX) * view.zoom;
    const sy = height / 2 + (model.y[index]! - view.centerY) * view.zoom;
    const hw = halfW[index]! * view.zoom + margin;
    const hh = halfH[index]! * view.zoom + margin;
    const dx = sx - hw < 0 ? sx - hw : sx + hw > width ? sx + hw - width : 0;
    const dy = sy - hh < 0 ? sy - hh : sy + hh > height ? sy + hh - height : 0;
    if (dx !== 0 || dy !== 0) setViewTo({ centerX: view.centerX + dx / view.zoom, centerY: view.centerY + dy / view.zoom, zoom: view.zoom }, 150, "user");
  }

  function announce(index: number): void {
    if (!live) return;
    const node = model.nodes[index]!;
    let text = node.label ?? node.id;
    try {
      if (options.messages?.describeNode) text = options.messages.describeNode(node as GraphNode);
    } catch {
      // Keep the label.
    }
    live.textContent = text;
  }

  return singleChartPlugin("graph", plugin);
}

function positive(value: number | undefined, fallback: number, allowZero = false): number {
  return typeof value === "number" && Number.isFinite(value) && (allowZero ? value >= 0 : value > 0) ? value : fallback;
}

function overlayCanvas(doc: Document, className: string, zIndex: number): HTMLCanvasElement {
  const canvas = doc.createElement("canvas");
  canvas.className = className;
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  canvas.style.pointerEvents = "none";
  canvas.style.zIndex = String(zIndex);
  return canvas;
}
