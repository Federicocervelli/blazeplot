export type Section = "home" | "docs" | "previews";
export type HomeDataMode = "static" | "streaming";
export type HomeChartMode = "line" | "ohlc" | "multi";
export type PreviewId = "live" | "sensor" | "features" | "histogram" | "linked" | "server-sampled" | "flamechart" | "render-loop" | "mobile";

export interface PreviewLink {
  title: string;
  id: PreviewId;
  description: string;
  docs: string;
}

export const PREVIEWS: readonly PreviewLink[] = [
  { title: "Live performance", id: "live", description: "Explore dense streaming data. Pause the stream or reset the view; expand Advanced for performance tuning.", docs: "performance-recipes" },
  { title: "Sensor stream", id: "sensor", description: "Watch irregular sensor samples and gaps. Pan into history, then use Resume live to return.", docs: "live-data" },
  { title: "Feature gallery", id: "features", description: "Toggle legend entries, hover for values, and drag the navigator to explore the visible range.", docs: "built-in-plugins" },
  { title: "Histogram", id: "histogram", description: "Hover a bar to inspect its bucket range and frequency. Scroll to zoom.", docs: "examples#histogram" },
  { title: "Linked charts", id: "linked", description: "Pan or zoom one chart to update the shared X range across both panels.", docs: "examples#linked-charts" },
  { title: "Server-sampled", id: "server-sampled", description: "Compare server-sampled history with a live feed. This example connects to Binance.", docs: "examples#server-sampled-min-max-buckets" },
  { title: "Flame chart", id: "flamechart", description: "Explore a synthetic execution trace. Hover a frame for details and scroll to zoom.", docs: "built-in-plugins" },
  { title: "Render loop", id: "render-loop", description: "Append a sample or change the viewport to compare on-demand and continuous rendering.", docs: "performance-recipes" },
  { title: "Mobile", id: "mobile", description: "Drag to pan, pinch to zoom, and double-tap to reset. On desktop, scroll to zoom or Shift-drag to pan.", docs: "theming-and-layout" },
] as const;

function appBaseUrl(): string {
  return import.meta.env?.BASE_URL ?? "/";
}

export function appHref(route: string): string {
  const baseUrl = appBaseUrl();
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedRoute = route.replace(/^\/+|\/+$/gu, "");
  return normalizedRoute === "" || normalizedRoute === "home" ? normalizedBase : `${normalizedBase}${normalizedRoute}`;
}

export function appRouteFromHash(hashHref: string): string | null {
  const hash = hashHref.replace(/^#/, "").replace(/^\/+|\/+$/gu, "");
  if (hash === "home") return "home";
  if (hash === "previews" || hash.startsWith("previews/") || hash.startsWith("docs/")) return hash;
  return null;
}

export function appRouteFromPath(pathname: string): string | null {
  const basePath = new URL(appBaseUrl(), window.location.origin).pathname;
  let relative = pathname;
  if (relative.startsWith(basePath)) relative = relative.slice(basePath.length);
  relative = relative.replace(/^\/+|\/+$/gu, "");

  if (relative === "") return "home";
  if (relative === "home") return "home";
  if (relative === "previews" || relative.startsWith("previews/") || relative.startsWith("docs/")) return relative;
  if (relative === "features") return "previews/features";
  if (relative === "histogram") return "previews/histogram";
  if (relative === "sensor") return "previews/sensor";
  if (relative === "linked") return "previews/linked";
  if (relative === "server-sampled") return "previews/server-sampled";
  if (relative === "flamechart") return "previews/flamechart";
  if (relative === "mobile") return "previews/mobile";
  return null;
}
