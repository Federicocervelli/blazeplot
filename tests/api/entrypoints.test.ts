import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Loads `src/index.ts` and every package subpath entry. In-process, to pin the runtime exports and
 * keep the public entry points covered; in a fresh process with no DOM, to prove that importing is
 * side-effect free (no globals, no output, nothing that keeps the process alive) and SSR-safe.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Exact runtime (value) exports per entry. Types are erased and are covered by `bun run test:api`. */
const expectedExports: Record<string, readonly string[]> = {
  ".": [
    "Canvas2DUnavailableError",
    "Chart",
    "DEFAULT_CHART_THEME",
    "HistogramDataset",
    "LIGHT_CHART_THEME",
    "OhlcRingBuffer",
    "RingBuffer",
    "ServerSampledDataset",
    "StaticDataset",
    "StaticOhlcDataset",
    "UniformRingBuffer",
    "WebGL2UnavailableError",
    "autoRenderer",
    "canvas2dRenderer",
    "createChartRenderContext",
    "histogram",
    "isWebGL2Available",
    "preloadWebGL",
    "sharedRenderer",
    "webgl2Renderer",
  ],
  "./linked": ["createLinkedCharts"],
  "./data": ["binSamples", "rollingMean"],
  "./export": ["chartDataToCsv", "copyChartScreenshotToClipboard", "downloadBlob", "downloadChartScreenshot", "exportChartData"],
  "./plugins/legend": ["legendPlugin"],
  "./plugins/tooltip": ["tooltipPlugin"],
  "./plugins/interactions": ["interactionsPlugin"],
  "./plugins/annotations": ["annotationsPlugin"],
  "./plugins/selection": ["selectionPlugin"],
  "./plugins/crosshair": ["crosshairPlugin"],
  "./plugins/navigator": ["navigatorPlugin"],
  "./plugins/flamegraph": ["buildStatusChartModel", "flameGraphPlugin", "parseFoldedStacks"],
  "./plugins/a11y": ["a11yPlugin"],
};

interface PackageJson {
  readonly exports: Record<string, string | { readonly import?: string }>;
}
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as PackageJson;

/** `./dist/plugins/legend.js` -> `src/plugins/legend.ts`. */
function sourceFor(subpath: string): string {
  const entry = pkg.exports[subpath];
  const built = typeof entry === "object" ? entry.import : undefined;
  if (!built) throw new Error(`${subpath} has no import entry`);
  return resolve(root, built.replace(/^\.\/dist\//, "src/").replace(/\.js$/, ".ts"));
}

const subpaths = Object.keys(pkg.exports).filter((subpath) => subpath !== "./package.json");

describe("package entry points", () => {
  it("expects exactly the subpaths package.json exports", () => {
    expect([...subpaths].sort()).toEqual(Object.keys(expectedExports).sort());
  });

  it("has a source file for every exported subpath and a matching Vite library entry", () => {
    const viteConfig = readFileSync(resolve(root, "vite.config.ts"), "utf8");
    for (const subpath of subpaths) {
      const source = sourceFor(subpath);
      expect(existsSync(source)).toBe(true);
      const relative = source.slice(root.length + 1).replace(/\\/g, "/");
      expect(viteConfig).toContain(`"${relative}"`);
    }
  });

  for (const subpath of subpaths) {
    describe(subpath, () => {
      it("exports exactly the documented runtime API", async () => {
        const mod = (await import(pathToFileURL(sourceFor(subpath)).href)) as Record<string, unknown>;
        expect(Object.keys(mod).sort()).toEqual([...expectedExports[subpath]!].sort());
        for (const name of expectedExports[subpath]!) expect(mod[name]).toBeDefined();
      });

      it("imports with no side effects in a fresh process without a DOM", async () => {
        const url = pathToFileURL(sourceFor(subpath)).href;
        const script = `
          const before = new Set(Object.getOwnPropertyNames(globalThis));
          const mod = await import(${JSON.stringify(url)});
          const added = Object.getOwnPropertyNames(globalThis).filter((key) => !before.has(key));
          process.stdout.write(JSON.stringify({ added, dom: [typeof document, typeof window], exports: Object.keys(mod).length }));
        `;
        const proc = Bun.spawn([process.execPath, "-e", script], { cwd: root, stdout: "pipe", stderr: "pipe" });
        const timer = setTimeout(() => proc.kill(), 20_000);
        const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
        clearTimeout(timer);
        expect(stderr).toBe("");
        expect(code).toBe(0);
        expect(JSON.parse(stdout)).toEqual({ added: [], dom: ["undefined", "undefined"], exports: expectedExports[subpath]!.length });
      });
    });
  }
});

describe("public API behavior reachable without a DOM", () => {
  it("constructs the dataset classes exported from the root entry", async () => {
    const api = await import("../../src/index.ts");
    const ring = new api.RingBuffer(4);
    ring.push(1, 2);
    expect(ring.length).toBe(1);
    expect(new api.UniformRingBuffer(4, { xStart: 0, xStep: 1 }).length).toBe(0);
    expect(new api.StaticDataset([0, 1], [2, 3]).length).toBe(2);
    expect(api.histogram([1, 2, 2, 3], { binCount: 2 }).bins.length).toBe(2);
    expect(api.DEFAULT_CHART_THEME).toBeDefined();
    expect(typeof api.isWebGL2Available()).toBe("boolean");
    expect(new api.WebGL2UnavailableError()).toBeInstanceOf(Error);
  });
});
