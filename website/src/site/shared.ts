export type Section = "home" | "docs" | "previews";
export type HomeDataMode = "static" | "streaming";
export type HomeChartMode = "line" | "ohlc" | "multi";
export type PreviewId = "live" | "sensor" | "features" | "histogram" | "linked" | "server-sampled" | "flamechart" | "render-loop" | "mobile";

export interface PreviewLink {
  title: string;
  id: PreviewId;
}

export const PREVIEWS: readonly PreviewLink[] = [
  { title: "Live performance", id: "live" },
  { title: "Sensor stream", id: "sensor" },
  { title: "Feature gallery", id: "features" },
  { title: "Histogram", id: "histogram" },
  { title: "Linked charts", id: "linked" },
  { title: "Server-sampled", id: "server-sampled" },
  { title: "Flame chart", id: "flamechart" },
  { title: "Render loop", id: "render-loop" },
  { title: "Mobile", id: "mobile" },
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
