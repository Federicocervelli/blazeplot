import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(__dirname, "preview"),
  base: "/blazeplot/",
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    target: "esnext",
    sourcemap: true,
    emptyOutDir: false,
    outDir: resolve(__dirname, "build/pages"),
  },
});
