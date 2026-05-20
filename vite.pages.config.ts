import { defineConfig } from "vite";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import packageJson from "./package.json" with { type: "json" };

const pagesBase = process.env.BLAZEPLOT_PAGES_BASE ?? "/blazeplot/";

export default defineConfig({
  plugins: [tailwindcss()],
  define: {
    __BLAZEPLOT_VERSION__: JSON.stringify(packageJson.version),
  },
  root: resolve(__dirname, "website"),
  base: pagesBase,
  publicDir: resolve(__dirname, "website/public"),
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    open: true,
    fs: {
      allow: [__dirname],
    },
  },
  build: {
    target: "esnext",
    sourcemap: true,
    emptyOutDir: true,
    outDir: resolve(__dirname, "build/pages"),
    rollupOptions: {
      input: {
        main: resolve(__dirname, "website/index.html"),
        notFound: resolve(__dirname, "website/404.html"),
      },
    },
  },
});
