import type { ReactiveController, ReactiveControllerHost } from "lit";
import { showChartFallback } from "./charts/dom.ts";
import type { PreviewId } from "./shared.ts";
import type { PreviewResources } from "./previews/resources.ts";

interface PreviewHost extends ReactiveControllerHost {
  readonly previewId: PreviewId;
  readonly renderRoot: HTMLElement | DocumentFragment;
}
const loaders = {
  live: () => import("./previews/live.ts"),
  sensor: () => import("./previews/sensor.ts"),
  features: () => import("./previews/features.ts"),
  histogram: () => import("./previews/histogram.ts"),
  linked: () => import("./previews/features.ts"),
  "server-sampled": () => import("./previews/server-sampled.ts"),
  flamechart: () => import("./previews/flamechart.ts"),
  "render-loop": () => import("./previews/render-loop.ts"),
  mobile: () => import("./previews/mobile.ts"),
} satisfies Record<PreviewId, () => Promise<{ default: new (host: PreviewHost) => PreviewResources }>>;

export class PreviewChartsController implements ReactiveController {
  private active: PreviewResources | null = null;
  private mountedId: PreviewId | null = null;
  private generation = 0;
  constructor(private readonly host: PreviewHost) { host.addController(this); }
  hostUpdated(): void { void this.mount(); }
  hostDisconnected(): void { this.generation++; this.active?.dispose(); this.active = null; this.mountedId = null; }
  private async mount(): Promise<void> {
    const id = this.host.previewId;
    if (id === this.mountedId) return;
    this.active?.dispose();
    this.active = null;
    this.mountedId = id;
    const generation = ++this.generation;
    const target = this.host.renderRoot.querySelector<HTMLElement>("[data-preview-chart]");
    if (!target) return;
    const visibleTarget = target.closest<HTMLElement>("[data-server-sampled-root]") ?? target;
    const loading = document.createElement("p");
    loading.setAttribute("role", "status");
    loading.className = "p-4 text-[#bbb]";
    loading.textContent = "Loading preview…";
    visibleTarget.append(loading);
    try {
      const module = await loaders[id]();
      if (generation !== this.generation) return;
      loading.remove();
      this.active = new module.default(this.host);
      this.active.mount(target);
    } catch (error) {
      if (generation !== this.generation) return;
      this.active?.dispose();
      this.active = null;
      showChartFallback(visibleTarget, error);
    } finally { loading.remove(); }
  }
}
