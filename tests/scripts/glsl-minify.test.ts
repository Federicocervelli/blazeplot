import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { minifyGlsl } from "../../scripts/glsl-minify.ts";

const SHADER_DIR = join(import.meta.dir, "../../src/render/shaders");

/** Token stream used to compare shaders: identifiers, numbers, and single punctuation characters. */
function tokens(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  return code.match(/[A-Za-z_][A-Za-z0-9_]*|\d+\.?\d*|\.\d+|\S/g) ?? [];
}

describe("minifyGlsl", () => {
  test("drops comments, indentation, blank lines, and spaces around punctuation", () => {
    const source = "// header\nuniform vec2 uScale;\n\n/* block */\nvoid main() {\n  float x = a * (b - 1.0);\n}\n";
    expect(minifyGlsl(source)).toBe("uniform vec2 uScale;void main(){float x=a*(b-1.0);}");
  });

  test("keeps words on separate lines apart", () => {
    expect(minifyGlsl("uniform\nfloat uSize;\n")).toBe("uniform float uSize;");
  });

  test("keeps preprocessor lines on their own line", () => {
    expect(minifyGlsl("#version 300 es\nprecision mediump float;\n#define A 1\n")).toBe("#version 300 es\nprecision mediump float;\n#define A 1");
  });

  test("never merges two minus signs into a decrement", () => {
    const source = "void main() { float x = a - -b; }";
    expect(minifyGlsl(source)).toBe(source);
  });

  test("keeps the token stream of every built-in shader", () => {
    for (const file of readdirSync(SHADER_DIR)) {
      const source = readFileSync(join(SHADER_DIR, file), "utf8");
      const minified = minifyGlsl(source);
      expect(minified.length).toBeLessThan(source.length);
      expect(tokens(minified)).toEqual(tokens(source));
    }
  });
});
