import { defineConfig } from "vite";
import { resolve } from "node:path";
import { glslMinifyPlugin } from "./scripts/glsl-minify.ts";

/**
 * Production build of the library-comparison page (`tests/browser/compare`). Every library is bundled
 * and minified the way an application would ship it, so the benchmark does not time Vite's dev
 * module graph. Output goes to `build/compare-site`, which `bun run bench:compare` serves.
 */
export default defineConfig({
  root: resolve(__dirname, "tests/browser"),
  plugins: [glslMinifyPlugin()],
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  build: {
    target: "esnext",
    outDir: resolve(__dirname, "build/compare-site"),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: { input: resolve(__dirname, "tests/browser/compare/index.html") },
  },
});
