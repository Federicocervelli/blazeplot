const imports = [
  { specifier: "blazeplot", expected: ["Chart", "RingBuffer", "StaticDataset", "ServerSampledDataset"] },
  { specifier: "blazeplot/core", expected: ["RingBuffer", "UniformRingBuffer", "StaticDataset", "ServerSampledDataset", "SeriesStore", "MinMaxPyramid"] },
  { specifier: "blazeplot/interaction", expected: ["Camera2D", "AxisController"] },
  { specifier: "blazeplot/render", expected: ["Renderer", "ReglBackend", "WebGL2Resources", "ShaderPrograms", "isWebGL2Available", "WebGL2UnavailableError"] },
  { specifier: "blazeplot/react", expected: ["BlazeChart"] },
  { specifier: "blazeplot/linked", expected: ["createLinkedCharts", "linkedChartsPlugin"] },
  { specifier: "blazeplot/linked-core", expected: ["createLinkedCharts", "linkedChartsPlugin"] },
  { specifier: "blazeplot/data", expected: ["exportVisibleChartData", "exportSelectedChartData", "chartDataToCSV", "binSamples", "rollingMean"] },
  { specifier: "blazeplot/export", expected: ["downloadChartScreenshot", "copyChartScreenshotToClipboard", "CHART_SCREENSHOT_PRESETS"] },
  { specifier: "blazeplot/plugins/legend", expected: ["legendPlugin"] },
  { specifier: "blazeplot/plugins/tooltip", expected: ["tooltipPlugin"] },
  { specifier: "blazeplot/plugins/interactions", expected: ["interactionsPlugin"] },
  { specifier: "blazeplot/plugins/annotations", expected: ["annotationsPlugin"] },
  { specifier: "blazeplot/plugins/selection", expected: ["selectionPlugin"] },
  { specifier: "blazeplot/plugins/crosshair", expected: ["crosshairPlugin"] },
  { specifier: "blazeplot/plugins/navigator", expected: ["navigatorPlugin"] },
] as const;

for (const entry of imports) {
  const moduleExports = await import(entry.specifier);
  for (const name of entry.expected) {
    if (!(name in moduleExports)) {
      throw new Error(`${entry.specifier} is missing expected export ${name}.`);
    }
  }
}

console.log(`Validated ${imports.length} package export subpaths.`);
