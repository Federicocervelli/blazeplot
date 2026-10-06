import { readFile } from "node:fs/promises";
import type { Plugin } from "vite";

const SHADER_RAW_IMPORT = /\.(?:vert|frag|glsl)\?raw$/;

/**
 * Shrink GLSL source without changing what it compiles to: drop comments, indentation, and
 * line breaks, and the spaces around operators and punctuation. Spaces between words
 * (`uniform vec2 uScale`) and the line breaks around preprocessor directives are kept.
 */
export function minifyGlsl(source: string): string {
  const minified = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " ").replace(/ ?([=+\-*/<>!?:;,(){}[\]&|]) ?/g, "$1"))
    .filter((line) => line.length > 0)
    .reduce((out, line, index, lines) => {
      if (index === 0) return line;
      const previous = lines[index - 1]!;
      // Preprocessor directives end at the line break; elsewhere a break is only whitespace.
      const separator = previous.startsWith("#") || line.startsWith("#") ? "\n" : /\w$/.test(previous) && /^\w/.test(line) ? " " : "";
      return out + separator + line;
    }, "");
  // `a - -b` would collapse into a decrement; such shaders keep their source formatting.
  return /--|\+\+/.test(minified) && !/--|\+\+/.test(source) ? source : minified;
}

/** Vite plugin: serve `*.vert?raw` / `*.frag?raw` imports as minified GLSL strings. */
export function glslMinifyPlugin(): Plugin {
  return {
    name: "blazeplot-glsl-minify",
    enforce: "pre",
    async load(id) {
      if (!SHADER_RAW_IMPORT.test(id)) return null;
      const source = await readFile(id.slice(0, -"?raw".length), "utf8");
      return `export default ${JSON.stringify(minifyGlsl(source))};`;
    },
  };
}
