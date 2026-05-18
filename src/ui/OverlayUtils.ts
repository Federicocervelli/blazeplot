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
