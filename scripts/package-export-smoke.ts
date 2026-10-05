import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type PackageJson = {
  exports: Record<string, unknown>;
};

const expectedExports = {
  "blazeplot": ["Chart", "RingBuffer", "UniformRingBuffer", "StaticDataset", "OhlcRingBuffer", "ServerSampledDataset", "HistogramDataset", "histogram", "isWebGL2Available", "WebGL2UnavailableError", "webgl2Renderer", "canvas2dRenderer", "sharedRenderer", "autoRenderer", "createChartRenderContext", "Canvas2DUnavailableError"],
  "blazeplot/linked": ["createLinkedCharts"],
  "blazeplot/data": ["binSamples", "histogramBins", "rollingMean"],
  "blazeplot/export": ["downloadChartScreenshot", "copyChartScreenshotToClipboard", "downloadBlob", "exportChartData", "chartDataToCsv"],
  "blazeplot/plugins/legend": ["legendPlugin"],
  "blazeplot/plugins/tooltip": ["tooltipPlugin"],
  "blazeplot/plugins/interactions": ["interactionsPlugin"],
  "blazeplot/plugins/annotations": ["annotationsPlugin"],
  "blazeplot/plugins/selection": ["selectionPlugin"],
  "blazeplot/plugins/crosshair": ["crosshairPlugin"],
  "blazeplot/plugins/navigator": ["navigatorPlugin"],
  "blazeplot/plugins/flamegraph": ["flameGraphPlugin", "buildStatusChartModel", "parseFoldedStacks"],
  "blazeplot/plugins/a11y": ["a11yPlugin"],
} as const;

const packageJsonPath = resolve(dirname(fileURLToPath(import.meta.url)), "../package.json");
const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as PackageJson;
const packageExportSpecifiers = Object.keys(packageJson.exports)
  .filter((subpath) => subpath !== "./package.json")
  .map((subpath) => subpath === "." ? "blazeplot" : `blazeplot/${subpath.slice(2)}`)
  .sort();

const coveredSpecifiers = Object.keys(expectedExports).sort();
for (const specifier of packageExportSpecifiers) {
  if (!(specifier in expectedExports)) {
    throw new Error(`${specifier} is declared in package.json exports but is not covered by package-export-smoke.ts.`);
  }
}
for (const specifier of coveredSpecifiers) {
  if (!packageExportSpecifiers.includes(specifier)) {
    throw new Error(`${specifier} is covered by package-export-smoke.ts but is not declared in package.json exports.`);
  }
}

for (const specifier of packageExportSpecifiers) {
  const moduleExports = await import(specifier);
  for (const name of expectedExports[specifier as keyof typeof expectedExports]) {
    if (!(name in moduleExports)) {
      throw new Error(`${specifier} is missing expected export ${name}.`);
    }
  }
}

const rootSpecifier: string = "blazeplot";
const rootExports = await import(rootSpecifier) as Record<string, unknown>;
for (const removed of ["ReglBackend", "MinMaxPyramid", "SeriesStore", "DataCursor", "histogramDataset", "WebGL2Backend"]) {
  if (removed in rootExports) throw new Error(`blazeplot should not export ${removed}.`);
}

const seriesTypes = await readFile(resolve(dirname(packageJsonPath), "dist/core/SeriesStore.d.ts"), "utf8");
for (const internal of ["copyRawRange", "rebuildPyramid", "nearestSampleByPoint"]) {
  if (seriesTypes.includes(internal)) throw new Error(`Published SeriesStore typings leak internal member ${internal}.`);
}

console.log(`Validated ${packageExportSpecifiers.length} package export subpaths.`);
