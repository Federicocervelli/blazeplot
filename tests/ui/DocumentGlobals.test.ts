import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const UI_DIR = join(import.meta.dir, "../../src/ui");

// Charts can live in an iframe, popup, or Document Picture-in-Picture window, so UI code must use
// the chart's own document and window (`layout.doc`, `ctx.dom.document`, `ctx.dom.view`).
const FORBIDDEN: readonly RegExp[] = [
  /(^|[^.\w])document\.(createElement|createElementNS|body|head|querySelector|getElementById|activeElement|addEventListener|removeEventListener)\b/,
  /(^|[^.\w])window\.\w/,
  /\bglobalThis\.(document|window|devicePixelRatio|requestAnimationFrame|cancelAnimationFrame|addEventListener|removeEventListener|innerWidth|innerHeight|matchMedia|getComputedStyle)\b/,
  /(^|[^.\w])(requestAnimationFrame|cancelAnimationFrame|getComputedStyle|matchMedia)\(/,
  /\binstanceof (HTML\w*Element|SVG\w*Element|Element|Node)\b/,
];

describe("src/ui avoids global document/window", () => {
  it("has no global DOM access outside documented fallbacks", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(UI_DIR).filter((name) => name.endsWith(".ts"))) {
      const lines = readFileSync(join(UI_DIR, file), "utf8").split("\n");
      lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (line.includes("ownerDocument ?? globalThis")) return; // documented fallback
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
        if (FORBIDDEN.some((pattern) => pattern.test(line))) offenders.push(`${file}:${index + 1}: ${trimmed}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

// Helpers outside src/ui that create DOM nodes must take a document (or derive one from the chart
// canvas) and only fall back to the global as a default value.
describe("data, export, render, and renderer helpers avoid global document", () => {
  const ROOT = join(import.meta.dir, "../../src");
  const files = [
    "export.ts",
    "data.ts",
    ...["render", "renderers"].flatMap((dir) => readdirSync(join(ROOT, dir)).filter((n) => n.endsWith(".ts")).map((n) => `${dir}/${n}`)),
  ];

  it("only references the global document as a parameter default or fallback", () => {
    const offenders: string[] = [];
    for (const file of files) {
      readFileSync(join(ROOT, file), "utf8").split("\n").forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
        if (/doc: Document = document\b/.test(line) || /= globalThis\.document\b/.test(line) || /\?\? globalThis\.document\b/.test(line)) return;
        if (FORBIDDEN.some((pattern) => pattern.test(line)) || /(^|[^.\w])document\.\w/.test(line)) {
          offenders.push(`${file}:${index + 1}: ${trimmed}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
