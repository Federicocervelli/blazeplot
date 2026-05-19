const imports = [
  { specifier: "blazeplot", path: "../dist/index.js", expected: ["Chart", "RingBuffer", "StaticDataset"] },
  { specifier: "blazeplot/react", path: "../dist/react.js", expected: ["BlazeChart"] },
  { specifier: "blazeplot/linked", path: "../dist/linked.js", expected: ["createLinkedCharts", "linkedChartsPlugin"] },
  { specifier: "blazeplot/export", path: "../dist/export.js", expected: ["downloadChartScreenshot", "copyChartScreenshotToClipboard", "CHART_SCREENSHOT_PRESETS"] },
  { specifier: "blazeplot/plugins/legend", path: "../dist/plugins/legend.js", expected: ["legendPlugin"] },
  { specifier: "blazeplot/plugins/tooltip", path: "../dist/plugins/tooltip.js", expected: ["tooltipPlugin"] },
  { specifier: "blazeplot/plugins/interactions", path: "../dist/plugins/interactions.js", expected: ["interactionsPlugin"] },
  { specifier: "blazeplot/plugins/annotations", path: "../dist/plugins/annotations.js", expected: ["annotationsPlugin"] },
  { specifier: "blazeplot/plugins/selection", path: "../dist/plugins/selection.js", expected: ["selectionPlugin"] },
  { specifier: "blazeplot/plugins/crosshair", path: "../dist/plugins/crosshair.js", expected: ["crosshairPlugin"] },
  { specifier: "blazeplot/plugins/navigator", path: "../dist/plugins/navigator.js", expected: ["navigatorPlugin"] },
] as const;

for (const entry of imports) {
  const moduleExports = await import(entry.path);
  for (const name of entry.expected) {
    if (!(name in moduleExports)) {
      throw new Error(`${entry.specifier} is missing expected export ${name}.`);
    }
  }
}

console.log(`Validated ${imports.length} package export subpaths.`);
