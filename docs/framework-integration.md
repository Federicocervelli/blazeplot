# Framework integration

This page is for developers embedding BlazePlot in React, Vue 3, Svelte 5, or a server-rendering framework such as Next.js, Nuxt, or SvelteKit. BlazePlot is framework-agnostic: a `Chart` owns one DOM subtree and one WebGL2 context, so every integration follows the same three rules.

1. Create the chart after the host element exists in the browser, never during render or on the server.
2. Dispose the chart when the owner unmounts. `chart.dispose()` is idempotent, so calling it twice is safe.
3. Give the host element an explicit size. The chart observes its plot area with a `ResizeObserver` and resizes itself; you do not call `resize()` from your framework.

Those rules are what keep a chart from leaking a WebGL context. Browsers cap live contexts, and a chart that is created on every re-render without disposal eventually loses older contexts. See [Troubleshooting](./troubleshooting.md#react-chart-is-duplicated-or-leaks) for the symptoms.

## The lifecycle in plain TypeScript

A framework wrapper is a thin shell around this function. It returns a cleanup function, which maps directly onto React's effect cleanup, Vue's `onBeforeUnmount`, and Svelte's action `destroy`.

```ts
import { Chart, StaticDataset } from "blazeplot";

export function mountChart(host: HTMLElement, x: number[], y: number[]): () => void {
  const chart = new Chart(host);
  chart.addLine({ dataset: new StaticDataset(x, y), name: "series" });
  chart.fitToData({ padding: 0.05 });
  chart.start();
  return () => chart.dispose();
}
```

## React

Create the chart in an effect and dispose it in that effect's cleanup. Keep the dependency array to values that should rebuild the chart.

```tsx
import { useEffect, useRef } from "react";
import { Chart, StaticDataset } from "blazeplot";

export function LineChart({ x, y }: { x: number[]; y: number[] }) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const chart = new Chart(host);
    chart.addLine({ dataset: new StaticDataset(x, y), name: "series" });
    chart.fitToData({ padding: 0.05 });
    chart.start();

    return () => chart.dispose();
  }, [x, y]);

  return <div ref={hostRef} style={{ width: "100%", height: 320 }} />;
}
```

### StrictMode and double mounting

In development, React `StrictMode` mounts every component, runs its cleanup, and mounts it again. The pattern above is safe because each effect run builds its own chart and its cleanup disposes exactly that chart. Two things break it:

- Storing the chart in a module-level variable or a ref and skipping creation when it already exists. The first cleanup disposes it, and the second mount then reuses a disposed chart.
- Constructing the chart in the component body or in `useMemo`. Render can run more than once without a matching cleanup.

Dispose removes the DOM BlazePlot created inside the host, so the same `<div>` can be reused by the second mount without clearing it yourself.

### Streaming data without rebuilding the chart

Rebuilding the chart on every data change throws away the GPU resources. For live data, create the chart once and append from an external subscription. Only values that should rebuild the chart (a different series layout, say) belong in the dependency array.

```tsx
import { useEffect, useRef } from "react";
import { Chart } from "blazeplot";

export function LiveChart({ subscribe }: { subscribe: (onSamples: (y: Float32Array) => void) => () => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const chart = new Chart(host, { followX: { window: 10_000, pauseOnInteraction: true } });
    const series = chart.addLine({
      capacity: 60_000,
      xStart: performance.now(),
      xStep: 16.6667,
      name: "signal",
    });
    chart.start();

    const unsubscribe = subscribe((y) => series.append({ y }));
    return () => {
      unsubscribe();
      chart.dispose();
    };
  }, [subscribe]);

  return <div ref={hostRef} style={{ width: "100%", height: 320 }} />;
}
```

Pass a stable `subscribe` (module-level or wrapped in `useCallback`). A new function identity on every render recreates the chart each time. See [Live data](./live-data.md) for dataset choices.

### Resizing

Do not add a `window` resize listener. The chart's own `ResizeObserver` reacts to the host changing size for any reason, including sidebars, tabs, and CSS grid changes. Make sure the host has a height: a block `<div>` with no content and no `height` collapses to zero and renders nothing. Use a fixed `height`, or a parent with a definite height and `height: 100%`.

### A reusable hook

When several components create charts, move the lifecycle into a hook. The hook runs your `setup` callback once per mount and disposes whatever chart it returns.

```tsx
import { useEffect, useRef, type DependencyList, type RefObject } from "react";
import { Chart, StaticDataset } from "blazeplot";

export function useChart<T extends HTMLElement>(
  setup: (host: T) => Chart,
  deps: DependencyList,
): RefObject<T | null> {
  const hostRef = useRef<T | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const chart = setup(host);
    return () => chart.dispose();
    // `setup` is intentionally excluded; `deps` decides when to rebuild.
  }, deps);

  return hostRef;
}

export function Telemetry({ x, y }: { x: number[]; y: number[] }) {
  const hostRef = useChart<HTMLDivElement>(
    (host) => {
      const chart = new Chart(host);
      chart.addLine({ dataset: new StaticDataset(x, y), name: "telemetry" });
      chart.fitToData();
      chart.start();
      return chart;
    },
    [x, y],
  );

  return <div ref={hostRef} style={{ height: 320 }} />;
}
```

## Vue 3

Use a template ref, create the chart in `onMounted`, and dispose it in `onBeforeUnmount`. Keep the chart in a plain variable, not in `ref()` or `reactive()`: Vue would wrap it in a deep reactive proxy, which adds cost and can break private-field access. If you need a reactive handle, use `shallowRef` with `markRaw`.

<!-- snippet: skip needs the vue package, which is not a dependency of this repository -->
```ts
// ChartPanel.vue
// <script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Chart, StaticDataset } from "blazeplot";

const props = defineProps<{ x: number[]; y: number[] }>();
const host = ref<HTMLDivElement | null>(null);
let chart: Chart | null = null;

function build() {
  chart?.dispose();
  chart = null;
  if (!host.value) return;
  chart = new Chart(host.value);
  chart.addLine({ dataset: new StaticDataset(props.x, props.y), name: "series" });
  chart.fitToData({ padding: 0.05 });
  chart.start();
}

onMounted(build);
watch(() => [props.x, props.y], build);
onBeforeUnmount(() => {
  chart?.dispose();
  chart = null;
});
// </script>
//
// <template>
//   <div ref="host" style="width: 100%; height: 320px" />
// </template>
```

For streaming data, create the chart once in `onMounted`, keep the `series` handle in a plain variable, and call `series.append(...)` from your subscription. Unsubscribe in `onBeforeUnmount` before disposing.

## Svelte 5

An action runs when its element is mounted and calls `destroy` when it is removed, which matches the chart lifecycle. Its `update` hook receives new parameters.

<!-- snippet: skip needs svelte, which is not a dependency of this repository -->
```ts
// chart.ts
import type { Action } from "svelte/action";
import { Chart, StaticDataset } from "blazeplot";

export const lineChart: Action<HTMLElement, { x: number[]; y: number[] }> = (host, data) => {
  let chart: Chart | null = null;

  function build(next: { x: number[]; y: number[] }) {
    chart?.dispose();
    chart = new Chart(host);
    chart.addLine({ dataset: new StaticDataset(next.x, next.y), name: "series" });
    chart.fitToData({ padding: 0.05 });
    chart.start();
  }

  build(data);
  return {
    update: build,
    destroy() {
      chart?.dispose();
      chart = null;
    },
  };
};

// Chart.svelte
// <script lang="ts">
//   import { lineChart } from "./chart";
//   let { x, y }: { x: number[]; y: number[] } = $props();
// </script>
//
// <div use:lineChart={{ x, y }} style="width: 100%; height: 320px"></div>
```

When the component owns the data and should react to runes, use `$effect`. Its returned function runs before the effect re-runs and when the component is destroyed.

<!-- snippet: skip needs svelte, which is not a dependency of this repository -->
```ts
// Chart.svelte
// <script lang="ts">
import { Chart, StaticDataset } from "blazeplot";

let { x, y }: { x: number[]; y: number[] } = $props();
let host: HTMLDivElement | undefined = $state();

$effect(() => {
  if (!host) return;
  const chart = new Chart(host);
  chart.addLine({ dataset: new StaticDataset(x, y), name: "series" });
  chart.fitToData({ padding: 0.05 });
  chart.start();
  return () => chart.dispose();
});
// </script>
//
// <div bind:this={host} style="width: 100%; height: 320px"></div>
```

## Server-side rendering

BlazePlot has no server renderer, and a chart needs a real DOM element and a WebGL2 context. What is safe on the server is narrower than "everything":

- **Importing is safe.** Importing `blazeplot` or any subpath (`blazeplot/linked`, `blazeplot/plugins/*`, and so on) has no side effects and does not touch `window` or `document`. `tests/api/entrypoints.test.ts` imports every entry point in a fresh process with no DOM and asserts that nothing global is created. Importing a chart module from a server-rendered component therefore does not crash the build.
- **Constructing is not safe.** `new Chart(...)`, `createLinkedCharts(...)`, and plugin installs need the DOM. Run them only in code that executes in the browser: `useEffect`, `onMounted`, an action, `$effect`, or a client-only component.
- **`isWebGL2Available()` returns `false` on the server** because there is no `document`. That `false` means "not in a browser", not "this browser lacks WebGL2". Do not render an "unsupported browser" message from a server-side check, or users with working browsers see it flash during hydration. Check it only after mount.

Render a same-sized placeholder on the server so the layout does not jump when the chart appears.

### Next.js

Client components still render on the server for the first HTML, but effects do not run there, so a component that creates the chart in `useEffect` (like the React examples above) is already safe. Add `next/dynamic` with `ssr: false` when you want to keep the chart code out of the server render entirely.

<!-- snippet: skip needs next, which is not a dependency of this repository -->
```tsx
// app/telemetry/page.tsx
"use client";

import dynamic from "next/dynamic";

const LineChart = dynamic(() => import("./LineChart"), {
  ssr: false,
  loading: () => <div style={{ height: 320 }} />,
});

export default function Page() {
  return <LineChart x={[0, 1, 2]} y={[3, 6, 4]} />;
}
```

In the App Router, `ssr: false` is only allowed inside a client component, which is why the page above starts with `"use client"`. In the Pages Router, `dynamic(..., { ssr: false })` works in any page or component.

### Nuxt

Wrap the chart in the built-in `<ClientOnly>` component, or name the file `ChartPanel.client.vue` so Nuxt only renders it in the browser. Use the same `onMounted` pattern as the Vue section.

<!-- snippet: skip needs nuxt, which is not a dependency of this repository -->
```ts
// pages/telemetry.vue
// <template>
//   <ClientOnly>
//     <ChartPanel :x="[0, 1, 2]" :y="[3, 6, 4]" />
//     <template #fallback>
//       <div style="height: 320px" />
//     </template>
//   </ClientOnly>
// </template>
```

### SvelteKit

`onMount`, actions, and `$effect` do not run on the server, so the Svelte patterns above are SSR-safe as written, and a static `import ... from "blazeplot"` is fine because importing has no side effects. If you prefer to load the library only in the browser, import it dynamically inside `onMount`.

<!-- snippet: skip needs svelte, which is not a dependency of this repository -->
```ts
// +page.svelte
// <script lang="ts">
import { onMount } from "svelte";

let host: HTMLDivElement | undefined = $state();

onMount(() => {
  let dispose = () => {};
  void import("blazeplot").then(({ Chart, StaticDataset }) => {
    if (!host) return;
    const chart = new Chart(host);
    chart.addLine({ dataset: new StaticDataset([0, 1, 2], [3, 6, 4]), name: "series" });
    chart.fitToData();
    chart.start();
    dispose = () => chart.dispose();
  });
  return () => dispose();
});
// </script>
//
// <div bind:this={host} style="width: 100%; height: 320px"></div>
```

The `dispose` indirection matters: the dynamic import resolves after `onMount` returns, so the cleanup must read the latest `dispose` when it runs. If the component is destroyed before the import resolves, the chart is created on a detached host; add a `destroyed` flag if that matters for your page.

## No-WebGL2 fallback

There is no Canvas2D or SVG renderer, so a browser without WebGL2 cannot draw a chart. Decide what those users see. There are two ways to detect it, and they behave differently:

| Check | What it tells you | Behavior |
|---|---|---|
| `isWebGL2Available()` | A throwaway canvas can create a WebGL2 context right now. | Returns `false` when `document` is undefined (server-side). Releases the probe context before returning. |
| `new Chart(...)` throws `WebGL2UnavailableError` | The real chart canvas could not get a context. | The error has `name === "WebGL2UnavailableError"`. Before throwing, the constructor removes the DOM it created, so the host is left as it was. |

A `true` result from `isWebGL2Available()` does not guarantee the real chart gets a context, for example when the browser has run out of GPU contexts. Use the probe to choose the fallback up front, and keep the `try`/`catch` for the case where construction still fails. Match the error with `instanceof WebGL2UnavailableError`; other constructor errors (invalid options) are `RangeError` or `TypeError` and should not show the fallback. See [Error handling](./error-handling.md).

In React, track the outcome in state so React renders the fallback instead of you writing into a host React owns:

```tsx
import { useEffect, useRef, useState } from "react";
import { Chart, StaticDataset, WebGL2UnavailableError, isWebGL2Available } from "blazeplot";

export function SafeChart({ x, y }: { x: number[]; y: number[] }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [unsupported, setUnsupported] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!isWebGL2Available()) {
      setUnsupported(true);
      return;
    }

    let chart: Chart;
    try {
      chart = new Chart(host);
    } catch (error) {
      if (error instanceof WebGL2UnavailableError) {
        setUnsupported(true);
        return;
      }
      throw error;
    }

    setUnsupported(false);
    chart.addLine({ dataset: new StaticDataset(x, y), name: "series" });
    chart.fitToData({ padding: 0.05 });
    chart.start();
    return () => chart.dispose();
  }, [x, y]);

  return (
    <>
      <div ref={hostRef} style={{ height: 320, display: unsupported ? "none" : "block" }} />
      {unsupported && (
        <p role="status">
          This chart needs WebGL2, which is not available in this browser. The data has {Math.min(x.length, y.length)} samples.
        </p>
      )}
    </>
  );
}
```

The host stays mounted (hidden when unsupported) so the ref remains valid across effect runs. The same shape works in every framework: probe after mount, construct inside `try`, and swap in your own UI (a static image from your backend, a table, a download link) on `WebGL2UnavailableError`. For a framework-free version, see [Browser support](./browser-support.md#unsupported-browser-fallback).

## Where to go next

- [Troubleshooting](./troubleshooting.md) for blank charts and lifecycle mistakes.
- [Live data](./live-data.md) for append patterns to wire into a subscription.
- [Browser support](./browser-support.md) and [Error handling](./error-handling.md) for the WebGL2 requirement and thrown errors.
