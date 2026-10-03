export type Section = "home" | "docs" | "previews";
export type HomeDataMode = "static" | "streaming";
export type HomeChartMode = "line" | "ohlc" | "multi";
export type PreviewId = "live" | "sensor" | "features" | "histogram" | "linked" | "server-sampled" | "flamechart" | "render-loop" | "mobile";

export interface PreviewLink {
  title: string;
  id: PreviewId;
  group: string;
  description: string;
  docs: string;
  /** File under website/src/site/previews/ that implements the demo. */
  source: string;
}

export const PREVIEWS: readonly PreviewLink[] = [
  { title: "Live performance", id: "live", group: "Streaming", description: "Dense streaming data across line, area, scatter, bar, and OHLC series. Pause the stream, follow the latest samples, or open the advanced panel to tune rates and export a screenshot.", docs: "performance-recipes", source: "live.ts" },
  { title: "Sensor stream", id: "sensor", group: "Streaming", description: "Irregular sensor samples with dropouts on two Y axes. Pan back into history, then resume live to return to the latest reading.", docs: "live-data", source: "sensor.ts" },
  { title: "Server-sampled", id: "server-sampled", group: "Streaming", description: "Server-side min/max buckets from the Binance public API next to a live 5s candle feed built from trades. This demo connects to Binance.", docs: "examples#server-sampled-min-max-buckets", source: "server-sampled.ts" },
  { title: "Feature gallery", id: "features", group: "Interaction", description: "Area, line, and scatter series with annotations, a navigator, and a toggleable legend. Hover for values; hold Ctrl and drag to measure.", docs: "built-in-plugins", source: "features.ts" },
  { title: "Linked charts", id: "linked", group: "Interaction", description: "Two panels sharing one X range, the lower one on a log scale. Pan or zoom either chart and the other follows.", docs: "examples#linked-charts", source: "features.ts" },
  { title: "Mobile", id: "mobile", group: "Interaction", description: "Drag to pan, pinch to zoom, and double-tap to reset. On desktop, scroll to zoom or Shift-drag to pan.", docs: "theming-and-layout", source: "mobile.ts" },
  { title: "Histogram", id: "histogram", group: "Chart types", description: "Binned values drawn as bars. Hover a bar to inspect its bucket range and frequency; scroll to zoom.", docs: "examples#histogram", source: "histogram.ts" },
  { title: "Flame chart", id: "flamechart", group: "Chart types", description: "A synthetic execution trace rendered with the flamegraph plugin. Hover a frame for details and scroll to zoom.", docs: "built-in-plugins", source: "flamechart.ts" },
  { title: "Render loop", id: "render-loop", group: "Rendering", description: "On-demand and continuous rendering side by side. Append a sample or move the viewport and compare the render counters.", docs: "performance-recipes", source: "render-loop.ts" },
] as const;

export const PREVIEW_GROUPS: readonly string[] = [...new Set(PREVIEWS.map((preview) => preview.group))];

export const REPO_URL = "https://github.com/Federicocervelli/blazeplot";

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
  if (relative === "docs") return "docs/overview";
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
