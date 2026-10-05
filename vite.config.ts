import { defineConfig } from "vite";
import { resolve } from "node:path";
import { glslMinifyPlugin } from "./scripts/glsl-minify.ts";

export default defineConfig(({ command }) => {
  const root = command === "serve" ? resolve(__dirname, "tests/browser") : __dirname;

  return {
    root,
    plugins: [glslMinifyPlugin()],
    resolve: {
      alias: {
        "@": resolve(__dirname, "src"),
      },
    },
    build: {
      target: "esnext",
      sourcemap: "hidden",
      emptyOutDir: true,
      outDir: resolve(__dirname, "dist"),
      lib: {
        entry: {
          index: resolve(__dirname, "src/index.ts"),
          linked: resolve(__dirname, "src/linked.ts"),
          data: resolve(__dirname, "src/data.ts"),
          export: resolve(__dirname, "src/export.ts"),
          "renderers/canvas2d": resolve(__dirname, "src/renderers/canvas2d.ts"),
          "renderers/shared": resolve(__dirname, "src/renderers/shared.ts"),
          "plugins/legend": resolve(__dirname, "src/plugins/legend.ts"),
          "plugins/tooltip": resolve(__dirname, "src/plugins/tooltip.ts"),
          "plugins/interactions": resolve(__dirname, "src/plugins/interactions.ts"),
          "plugins/annotations": resolve(__dirname, "src/plugins/annotations.ts"),
          "plugins/selection": resolve(__dirname, "src/plugins/selection.ts"),
          "plugins/crosshair": resolve(__dirname, "src/plugins/crosshair.ts"),
          "plugins/navigator": resolve(__dirname, "src/plugins/navigator.ts"),
          "plugins/flamegraph": resolve(__dirname, "src/plugins/flamegraph.ts"),
          "plugins/a11y": resolve(__dirname, "src/plugins/a11y.ts"),
        },
        formats: ["es"],
        fileName: (_format, entryName) => `${entryName}.js`,
      },
    },
    server: {
      open: process.env.BLAZEPLOT_BENCH !== "1",
    },
  };
});
