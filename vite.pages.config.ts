import { defineConfig } from "vite";
import { resolve } from "node:path";

const pagesBase = process.env.BLAZEPLOT_PAGES_BASE ?? "/blazeplot/";

export default defineConfig({
  root: resolve(__dirname, "preview"),
  base: pagesBase,
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    target: "esnext",
    sourcemap: true,
    emptyOutDir: true,
    outDir: resolve(__dirname, "build/pages"),
    rollupOptions: {
      input: {
        main: resolve(__dirname, "preview/index.html"),
        features: resolve(__dirname, "preview/features/index.html"),
        serverSampled: resolve(__dirname, "preview/server-sampled/index.html"),
        react: resolve(__dirname, "preview/react/index.html"),
        mobile: resolve(__dirname, "preview/mobile/index.html"),
      },
    },
  },
});
