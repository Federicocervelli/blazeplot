/**
 * Pure flame graph model code: parsing folded stacks, building frame models (flame graph and
 * flame chart tries, status spans), level indexes, frame picking, and depth mapping. No DOM, no chart.
 */
import type {
  BuildFlameGraphModelOptions,
  BuildStatusChartModelOptions,
  FlameGraphFoldedStack,
  FlameGraphFrame,
  FlameGraphLevelIndex,
  FlameGraphModel,
  FlameGraphPluginOptions,
  FlameGraphRenderableFrame,
  FlameGraphStatusSpan,
} from "./types.js";

interface TrieNode<T> {
  name: string;
  value: number;
  metadata?: T;
  children: Map<string, TrieNode<T>>;
}

/**
 * Parse folded stack text into stack samples.
 *
 * @experimental May change in a minor release before it is promoted to stable. See docs/stability.md.
 */
export function parseFoldedStacks<T = unknown>(input: string, separator = ";"): FlameGraphFoldedStack<T>[] {
  const stacks: FlameGraphFoldedStack<T>[] = [];
  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^(.*)\s+(-?\d+(?:\.\d+)?)(?:\s+(-?\d+(?:\.\d+)?))?$/.exec(line);
    if (!match) continue;
    const stack = match[1]?.trim();
    const value = Number(match[2]);
    if (!stack || !Number.isFinite(value)) continue;
    const delta = match[3] === undefined ? undefined : Number(match[3]) - value;
    stacks.push({ stack: stack.split(separator), value, delta });
  }
  return stacks;
}

/**
 * @internal Build a renderable flame graph model from folded stacks. Not part of the public API:
 * pass `foldedStacks` and `build` to `flameGraphPlugin()` or call `plugin.setFoldedStacks()` instead.
 */
export function buildFlameGraphModel<T = unknown>(
  input: string | readonly FlameGraphFoldedStack<T>[],
  options: BuildFlameGraphModelOptions = {},
): FlameGraphModel<T> {
  const stacks = typeof input === "string" ? parseFoldedStacks<T>(input, options.separator) : input;
  const normalized = stacks
    .map((entry) => ({ ...entry, parts: normalizeStack(entry.stack, options.separator) }))
    .filter((entry) => entry.parts.length > 0 && Number.isFinite(entry.value) && entry.value > 0);

  if (options.flameChart) return buildFlameChartModel(normalized, options);

  const sort = options.sort === false ? undefined : options.sort === true || options.sort === undefined ? defaultSort : options.sort;
  if (sort) normalized.sort((a, b) => compareStacks(a.parts, b.parts, sort));

  const root: TrieNode<T> = { name: options.rootName ?? "all", value: 0, children: new Map<string, TrieNode<T>>() };
  for (const entry of normalized) {
    root.value += entry.value;
    let node = root;
    for (const part of entry.parts) {
      let child = node.children.get(part);
      if (!child) {
        child = { name: part, value: 0, children: new Map<string, TrieNode<T>>() };
        node.children.set(part, child);
      }
      child.value += entry.value;
      if (entry.metadata !== undefined) child.metadata = entry.metadata;
      node = child;
    }
  }

  const frames: FlameGraphFrame<T>[] = [];
  const childSort = sort ?? defaultSort;
  const appendNode = (node: TrieNode<T>, start: number, depth: number, parent?: number): number => {
    const index = frames.length;
    const shouldPush = depth >= 0;
    if (shouldPush) {
      frames.push({ name: node.name, start, value: node.value, depth, metadata: node.metadata, parent });
    }
    let childStart = start;
    const frameParent = shouldPush ? index : undefined;
    const children = Array.from(node.children.values()).sort((a, b) => childSort(a.name, b.name));
    for (const child of children) {
      appendNode(child, childStart, depth + 1, frameParent);
      childStart += child.value;
    }
    return index;
  };
  appendNode(root, 0, options.includeRoot ? 0 : -1);
  return finalizeModel(frames, root.value, options.countName ?? "samples");
}

/**
 * Build a flame-graph-compatible model from categorical status spans.
 *
 * @experimental May change in a minor release before it is promoted to stable. See docs/stability.md.
 */
export function buildStatusChartModel<T = unknown>(
  spans: readonly FlameGraphStatusSpan<T>[],
  options: BuildStatusChartModelOptions = {},
): FlameGraphModel<T> {
  const frames: FlameGraphFrame<T>[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  for (const span of spans) {
    const start = span.start;
    const end = span.end ?? (span.value === undefined ? NaN : span.start + span.value);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    minX = Math.min(minX, start);
    maxX = Math.max(maxX, end);
    frames.push({
      name: span.name,
      start,
      value: end - start,
      depth: Math.max(0, Math.floor(span.depth ?? 0)),
      color: span.color,
      id: span.id,
      metadata: span.metadata,
    });
  }
  return finalizeModel(frames, Number.isFinite(maxX - minX) ? maxX - minX : 0, options.countName ?? "time");
}

/**
 * @internal Return the rendered frame at a model coordinate, if any. Not part of the public API:
 * use `plugin.pick(clientX, clientY)` instead.
 */
export function pickFrame<T>(model: FlameGraphModel<T>, dataX: number, dataY: number): FlameGraphRenderableFrame<T> | null {
  const depth = Math.floor(dataY);
  const level = model.levels[depth];
  if (!level || !Number.isFinite(dataX)) return null;
  const insertion = upperBound(level.starts, dataX);
  const candidates = [insertion - 1, insertion];
  for (const position of candidates) {
    if (position < 0 || position >= level.indices.length) continue;
    const frame = model.frames[level.indices[position]!];
    if (frame && dataX >= frame.start && dataX <= frame.end) return frame;
  }
  return null;
}

export function initialModel<T>(options: FlameGraphPluginOptions<T>): FlameGraphModel<T> {
  if (options.model) return options.model;
  if (options.statusSpans) return buildStatusChartModel(options.statusSpans);
  if (options.foldedStacks) return buildFlameGraphModel(options.foldedStacks, options.build);
  return finalizeModel([], 0, options.build?.countName ?? "samples");
}

export function normalizeStack(stack: string | readonly string[], separator = ";"): string[] {
  const parts = typeof stack === "string" ? stack.split(separator) : Array.from(stack);
  return parts.map((part) => String(part).trim()).filter(Boolean);
}

export function buildFlameChartModel<T>(
  entries: readonly (FlameGraphFoldedStack<T> & { readonly parts: readonly string[] })[],
  options: BuildFlameGraphModelOptions,
): FlameGraphModel<T> {
  const frames: FlameGraphFrame<T>[] = [];
  let x = 0;
  for (const entry of entries) {
    let parent: number | undefined;
    for (let depth = 0; depth < entry.parts.length; depth++) {
      const index = frames.length;
      frames.push({ name: entry.parts[depth]!, start: x, value: entry.value, depth, metadata: entry.metadata, parent });
      parent = index;
    }
    x += entry.value;
  }
  return finalizeModel(frames, x, options.countName ?? "samples");
}

export function finalizeModel<T>(frames: readonly FlameGraphFrame<T>[], total: number, countName: string): FlameGraphModel<T> {
  const renderable = frames
    .filter((frame) => Number.isFinite(frame.start) && Number.isFinite(frame.value) && Number.isFinite(frame.depth) && frame.value > 0 && frame.depth >= 0)
    .map((frame, index): FlameGraphRenderableFrame<T> => ({ ...frame, index, end: frame.start + frame.value }));

  const levelMap = new Map<number, FlameGraphRenderableFrame<T>[]>();
  let minX = Infinity;
  let maxX = -Infinity;
  let maxDepth = 0;
  for (const frame of renderable) {
    const level = levelMap.get(frame.depth) ?? [];
    level.push(frame);
    levelMap.set(frame.depth, level);
    minX = Math.min(minX, frame.start);
    maxX = Math.max(maxX, frame.end);
    maxDepth = Math.max(maxDepth, frame.depth);
  }

  const levels: FlameGraphLevelIndex[] = [];
  for (const depth of Array.from(levelMap.keys()).sort((a, b) => a - b)) {
    const levelFrames = levelMap.get(depth)!.sort((a, b) => a.start - b.start || a.end - b.end);
    levels[depth] = {
      depth,
      indices: levelFrames.map((frame) => frame.index),
      starts: levelFrames.map((frame) => frame.start),
    };
  }

  return {
    frames: renderable,
    levels,
    total: Number.isFinite(total) ? total : 0,
    minX: Number.isFinite(minX) ? minX : 0,
    maxX: Number.isFinite(maxX) ? maxX : 1,
    maxDepth,
    countName,
  };
}

export function compareStacks(a: readonly string[], b: readonly string[], sort: (a: string, b: string) => number): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const result = sort(a[i]!, b[i]!);
    if (result !== 0) return result;
  }
  return a.length - b.length;
}

export function defaultSort(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function modelDepthToRenderDepth(depth: number, model: FlameGraphModel<unknown>, inverted: boolean): number {
  return inverted ? model.maxDepth - depth : depth;
}

export function renderDepthToModelDepth(depth: number, model: FlameGraphModel<unknown>, inverted: boolean): number {
  return inverted ? model.maxDepth - depth : depth;
}

export function modelDepthFromRenderY(y: number, model: FlameGraphModel<unknown>, inverted: boolean): number {
  return inverted ? model.maxDepth - Math.floor(y) : Math.floor(y);
}

export function upperBound(values: readonly number[], target: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid]! <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
