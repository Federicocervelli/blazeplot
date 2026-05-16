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
        entry: resolve(__dirname, "src/index.ts"),
        formats: ["es"],
        fileName: "index",
      },
      rollupOptions: {
        external: ["regl"],
      },
    },
    server: {
      open: true,
    },
  };
});
