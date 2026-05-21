import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type PackageJson = {
  exports: Record<string, unknown>;
};

const expectedExports = {
  "blazeplot": ["Chart", "RingBuffer", "StaticDataset", "ServerSampledDataset", "WebGL2Backend", "ReglBackend"],
  "blazeplot/core": ["RingBuffer", "UniformRingBuffer", "StaticDataset", "ServerSampledDataset", "SeriesStore", "MinMaxPyramid"],
  "blazeplot/interaction": ["Camera2D", "AxisController"],
  "blazeplot/render": ["Renderer", "WebGL2Backend", "ReglBackend", "WebGL2Resources", "ShaderPrograms", "isWebGL2Available", "WebGL2UnavailableError"],
  "blazeplot/react": ["BlazeChart"],
  "blazeplot/linked": ["createLinkedCharts", "linkedChartsPlugin"],
  "blazeplot/linked-core": ["createLinkedCharts", "linkedChartsPlugin"],
  "blazeplot/data": ["exportVisibleChartData", "exportSelectedChartData", "chartDataToCSV", "binSamples", "rollingMean"],
  "blazeplot/export": ["downloadChartScreenshot", "copyChartScreenshotToClipboard", "CHART_SCREENSHOT_PRESETS"],
  "blazeplot/plugins/legend": ["legendPlugin"],
  "blazeplot/plugins/tooltip": ["tooltipPlugin"],
  "blazeplot/plugins/interactions": ["interactionsPlugin"],
  "blazeplot/plugins/annotations": ["annotationsPlugin"],
  "blazeplot/plugins/selection": ["selectionPlugin"],
  "blazeplot/plugins/crosshair": ["crosshairPlugin"],
  "blazeplot/plugins/navigator": ["navigatorPlugin"],
  "blazeplot/plugins/flamegraph": ["flameGraphPlugin", "buildFlameGraphModel", "buildStatusChartModel", "parseFoldedStacks"],
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

const importPackage = async (specifier: string): Promise<Record<string, unknown>> => await import(specifier) as Record<string, unknown>;
const rootExports = await importPackage("blazeplot");
const renderExports = await importPackage("blazeplot/render");
if (rootExports.ReglBackend !== rootExports.WebGL2Backend) {
  throw new Error("blazeplot ReglBackend compatibility alias does not match WebGL2Backend.");
}
if (renderExports.ReglBackend !== renderExports.WebGL2Backend) {
  throw new Error("blazeplot/render ReglBackend compatibility alias does not match WebGL2Backend.");
}

console.log(`Validated ${packageExportSpecifiers.length} package export subpaths.`);
