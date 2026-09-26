import type { Chart } from "../../../../src/index.ts";

export abstract class PreviewResources {
  protected previewCharts: Chart[] = [];
  protected previewDisposers: Array<() => void> = [];
  constructor(protected readonly host: { readonly renderRoot: HTMLElement | DocumentFragment }) {}
  abstract mount(target: HTMLElement): void;
  protected requireControl<T extends HTMLElement>(root: ParentNode, selector: string): T {
    const control = root.querySelector<T>(selector);
    if (!control) throw new Error(`Missing preview control: ${selector}`);
    return control;
  }
  dispose(): void {
    for (const dispose of this.previewDisposers.splice(0)) dispose();
    for (const chart of this.previewCharts.splice(0)) chart.dispose();
  }
}
