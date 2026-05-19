import type { ChartPickItem } from "./Chart.js";

export function labelOfPickItem(item: ChartPickItem): string {
  return item.name ?? item.id ?? `${item.mode} ${item.seriesIndex + 1}`;
}

export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const abs = Math.abs(value);
  if (abs > 0 && (abs < 1e-3 || abs >= 1e6)) return value.toExponential(3);
  return Number(value.toPrecision(6)).toString();
}

export function rgba(color: readonly [number, number, number, number]): string {
  return `rgba(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)}, ${color[3]})`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function placeFixedWithinViewport(
  element: HTMLElement,
  clientX: number,
  clientY: number,
  options: { readonly offsetX: number; readonly offsetY: number; readonly margin?: number },
): void {
  const rect = element.getBoundingClientRect();
  const margin = options.margin ?? 4;
  const doc = element.ownerDocument;
  const viewportWidth = Math.max(1, globalThis.innerWidth || doc.documentElement.clientWidth);
  const viewportHeight = Math.max(1, globalThis.innerHeight || doc.documentElement.clientHeight);
  const x = clamp(clientX + options.offsetX, margin, Math.max(margin, viewportWidth - rect.width - margin));
  const y = clamp(clientY + options.offsetY, margin, Math.max(margin, viewportHeight - rect.height - margin));
  element.style.transform = `translate(${x}px, ${y}px)`;
}

export function placeAbsoluteWithinBox(
  element: HTMLElement,
  x: number,
  y: number,
  width: number,
  height: number,
  options: { readonly offsetX: number; readonly offsetY: number; readonly margin?: number },
): void {
  const rect = element.getBoundingClientRect();
  const margin = options.margin ?? 4;
  const left = clamp(x + options.offsetX, margin, Math.max(margin, width - rect.width - margin));
  const top = clamp(y + options.offsetY, margin, Math.max(margin, height - rect.height - margin));
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
}

export function renderPickItems<TContext>(
  container: HTMLElement,
  items: readonly ChartPickItem[],
  context: TContext,
  formatter: ((item: ChartPickItem, context: TContext) => string) | undefined,
  defaultFormatter: (item: ChartPickItem, context: TContext) => string,
): void {
  const pad = Math.max(1, ...items.map((item) => labelOfPickItem(item).length));
  let html = "";
  for (const item of items) {
    const value = formatter ? formatter(item, context) : defaultFormatter(item, context);
    if (html) html += "<br>";
    html += `<span style="color:${rgba(item.series.style.color)}">\u2588</span> ${labelOfPickItem(item).padEnd(pad)}  ${value}`;
  }
  container.innerHTML = html;
}

export interface PickMarkerOptions {
  readonly sizePx?: number;
  readonly strokeColor?: string;
  readonly strokeWidthPx?: number;
}

export function createPickMarker(item: ChartPickItem, options: PickMarkerOptions = {}): HTMLDivElement {
  const marker = document.createElement("div");
  marker.style.position = "absolute";
  marker.style.left = `${item.plotX}px`;
  marker.style.top = `${item.plotY}px`;
  marker.style.width = `${options.sizePx ?? 10}px`;
  marker.style.height = `${options.sizePx ?? 10}px`;
  marker.style.border = `${options.strokeWidthPx ?? 2}px solid ${options.strokeColor ?? "#f8fafc"}`;
  marker.style.borderRadius = "999px";
  marker.style.background = rgba(item.series.style.color);
  marker.style.boxShadow = "0 0 0 1px rgba(4, 8, 16, 0.85)";
  marker.style.transform = "translate(-50%, -50%)";
  return marker;
}

export interface LongPressTouchTrackerOptions {
  readonly delayMs: () => number | false | undefined;
  readonly onPoint: (clientX: number, clientY: number) => void;
  readonly movementThresholdPx?: number;
}

export interface LongPressTouchTracker {
  clear(): void;
  schedule(clientX: number, clientY: number): void;
  onTouchStart(event: TouchEvent): void;
  onTouchMove(event: TouchEvent): void;
  onPointerDown(event: PointerEvent): void;
  onPointerMove(event: PointerEvent): boolean;
  clearIfTouchPointer(event: PointerEvent): void;
}

export function createLongPressTouchTracker(options: LongPressTouchTrackerOptions): LongPressTouchTracker {
  const movementThresholdPx = options.movementThresholdPx ?? 8;
  let timer: number | null = null;
  let raf = 0;
  let active = false;
  let clientX = 0;
  let clientY = 0;

  const clear = (): void => {
    if (timer !== null) window.clearTimeout(timer);
    if (raf !== 0) window.cancelAnimationFrame(raf);
    timer = null;
    raf = 0;
    active = false;
  };

  const refresh = (): void => {
    if (!active) return;
    options.onPoint(clientX, clientY);
    raf = window.requestAnimationFrame(refresh);
  };

  const activate = (): void => {
    timer = null;
    active = true;
    options.onPoint(clientX, clientY);
    raf = window.requestAnimationFrame(refresh);
  };

  const schedule = (nextClientX: number, nextClientY: number): void => {
    const delayMs = options.delayMs();
    if (delayMs === false || active) return;
    clientX = nextClientX;
    clientY = nextClientY;
    clear();
    timer = window.setTimeout(activate, delayMs ?? 450);
  };

  const handleMove = (event: TouchEvent | PointerEvent, nextClientX: number, nextClientY: number): void => {
    if (active) {
      event.preventDefault();
      event.stopPropagation();
      clientX = nextClientX;
      clientY = nextClientY;
      options.onPoint(clientX, clientY);
      return;
    }
    if (timer !== null && Math.hypot(nextClientX - clientX, nextClientY - clientY) > movementThresholdPx) clear();
  };

  return {
    clear,
    schedule,
    onTouchStart(event: TouchEvent): void {
      if (event.touches.length !== 1) {
        clear();
        return;
      }
      const touch = event.touches.item(0);
      if (!touch) return;
      schedule(touch.clientX, touch.clientY);
    },
    onTouchMove(event: TouchEvent): void {
      const touch = event.touches.item(0);
      if (!touch) return;
      handleMove(event, touch.clientX, touch.clientY);
    },
    onPointerDown(event: PointerEvent): void {
      if (event.pointerType !== "touch") return;
      schedule(event.clientX, event.clientY);
    },
    onPointerMove(event: PointerEvent): boolean {
      if (event.pointerType !== "touch") return false;
      handleMove(event, event.clientX, event.clientY);
      return true;
    },
    clearIfTouchPointer(event: PointerEvent): void {
      if (event.pointerType === "touch") clear();
    },
  };
}
