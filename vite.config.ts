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
          "plugins/legend": resolve(__dirname, "src/plugins/legend.ts"),
          "plugins/tooltip": resolve(__dirname, "src/plugins/tooltip.ts"),
        },
        formats: ["es"],
        fileName: (_format, entryName) => `${entryName}.js`,
      },
      rollupOptions: {
        external: ["regl"],
      },
    },
    server: {
      open: process.env.BLAZEPLOT_BENCH !== "1",
    },
  };
});
