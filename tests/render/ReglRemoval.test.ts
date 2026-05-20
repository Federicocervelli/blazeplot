import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { WebGL2Backend, ReglBackend, WebGL2UnavailableError, isWebGL2Available } from "../../src/render/index.ts";

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...listSourceFiles(path));
    } else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry)) {
      files.push(path);
    }
  }
  return files;
}

describe("regl removal", () => {
  it("does not declare regl as a package dependency", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };

    const lockfile = readFileSync("bun.lock", "utf8");

    expect(packageJson.dependencies?.regl).toBeUndefined();
    expect(packageJson.devDependencies?.regl).toBeUndefined();
    expect(packageJson.peerDependencies?.regl).toBeUndefined();
    expect(lockfile).not.toContain('"regl"');
    expect(lockfile).not.toContain("regl@");
  });

  it("keeps source imports free of the regl package", () => {
    const offenders = listSourceFiles("src")
      .filter(path => !path.endsWith("ReglRemoval.test.ts"))
      .filter(path => /from\s+["']regl["']|import\s+[^;]*["']regl["']|import\(["']regl["']\)|require\(["']regl["']\)/.test(readFileSync(path, "utf8")));

    expect(offenders).toEqual([]);
  });

  it("exports WebGL2Backend while preserving ReglBackend as a deprecated compatibility alias", () => {
    expect(WebGL2Backend).toBe(ReglBackend);
    expect(typeof isWebGL2Available).toBe("function");
    expect(WebGL2UnavailableError.name).toBe("WebGL2UnavailableError");
  });
});
