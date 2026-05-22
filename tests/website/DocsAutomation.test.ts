import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "bun:test";

function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync("bun", args, { cwd: new URL("../..", import.meta.url).pathname, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("docs automation", () => {
  test("keeps public docs page metadata in one source of truth", () => {
    expect(existsSync("docs/pages.json")).toBe(true);
    const pages = JSON.parse(readFileSync("docs/pages.json", "utf8")) as Array<{ slug: string; sourcePath: string }>;
    expect(pages.some((page) => page.slug === "overview" && page.sourcePath === "docs/overview.md")).toBe(true);
    expect(pages.some((page) => page.slug === "api-reference" && page.sourcePath === "docs/api-reference.md")).toBe(true);
    expect(new Set(pages.map((page) => page.slug)).size).toBe(pages.length);
  });

  test("generated website docs registry is fresh", () => {
    const result = run(["scripts/generate-docs-registry.ts", "--check"]);
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  test("README generated docs and performance blocks are fresh", () => {
    const result = run(["scripts/generate-readme-docs.js", "--check"]);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    const readme = readFileSync("README.md", "utf8");
    expect(readme).toContain("<!-- README_PERFORMANCE_START -->");
    expect(readme).toContain("<!-- README_PERFORMANCE_END -->");
  });

  test("package export descriptions cover every public subpath", () => {
    const result = run(["scripts/generate-readme-docs.js", "--check-export-descriptions"]);
    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  test("documentation TypeScript snippets typecheck", () => {
    const result = run(["scripts/typecheck-doc-snippets.ts"]);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toContain("Typechecked");
  });
});
