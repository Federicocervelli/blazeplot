import { defineConfig } from "vite";
import { resolve } from "node:path";
import dts from "vite-plugin-dts";

export default defineConfig(({ command, mode }) => {
  const root = command === "serve" ? resolve(__dirname, "preview") : __dirname;

  return {
    root,
    plugins: command === "build" && mode !== "js-only" ? [
      dts({
        tsconfigPath: resolve(__dirname, "tsconfig.build.json"),
        entryRoot: resolve(__dirname, "src"),
        outDirs: resolve(__dirname, "dist"),
        insertTypesEntry: true,
      }),
    ] : [],
    resolve: {
      alias: {
        "@": resolve(__dirname, "src"),
      },
    },
    build: {
      target: "esnext",
      sourcemap: true,
      emptyOutDir: true,
      outDir: resolve(__dirname, "dist"),
      lib: {
        entry: {
          index: resolve(__dirname, "src/index.ts"),
          core: resolve(__dirname, "src/core/index.ts"),
          interaction: resolve(__dirname, "src/interaction/index.ts"),
          render: resolve(__dirname, "src/render/index.ts"),
          react: resolve(__dirname, "src/react.ts"),
          linked: resolve(__dirname, "src/linked.ts"),
          data: resolve(__dirname, "src/data.ts"),
          export: resolve(__dirname, "src/export.ts"),
          "plugins/legend": resolve(__dirname, "src/plugins/legend.ts"),
          "plugins/tooltip": resolve(__dirname, "src/plugins/tooltip.ts"),
          "plugins/interactions": resolve(__dirname, "src/plugins/interactions.ts"),
          "plugins/annotations": resolve(__dirname, "src/plugins/annotations.ts"),
          "plugins/selection": resolve(__dirname, "src/plugins/selection.ts"),
          "plugins/crosshair": resolve(__dirname, "src/plugins/crosshair.ts"),
          "plugins/navigator": resolve(__dirname, "src/plugins/navigator.ts"),
        },
        formats: ["es"],
        fileName: (_format, entryName) => `${entryName}.js`,
      },
      rollupOptions: {
        external: ["regl", "react"],
      },
    },
    server: {
      open: process.env.BLAZEPLOT_BENCH !== "1",
    },
  };
});
