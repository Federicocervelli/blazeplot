/**
 * Runs the engine-agnostic UI suites once per real engine (`BLAZEPLOT_TEST_ENGINE`), so chart
 * semantics, lifecycle cleanup, hover, viewport, accessibility, and plugin behavior are asserted on
 * Canvas 2D, WebGL2, and the shared WebGL2 engine, not only on the recording fake. The default
 * `bun test` run covers the fake engine. Suites that pick their own engine are left out.
 */
import { readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const engines = ["canvas2d", "webgl2", "shared"] as const;
/** Suites that choose their own engine or that are not about charts on an engine. */
// FlameGraph still owns a private WebGL layer; it joins the engine matrix when it draws through the chart engine.
const excluded = new Set(["Chart.renderer.test.ts", "Chart.sharedRenderer.test.ts", "FlameGraph.plugin.test.ts"]);
const suites = readdirSync(resolve(root, "tests/ui"))
  .filter((file) => file.endsWith(".test.ts") && !excluded.has(file))
  .map((file) => `tests/ui/${file}`);

async function run(engine: (typeof engines)[number]): Promise<{ engine: string; code: number; output: string }> {
  const child = Bun.spawn([process.execPath, "test", ...suites], {
    cwd: root,
    env: { ...process.env, BLAZEPLOT_TEST_ENGINE: engine },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { engine, code, output: `${stdout}${stderr}` };
}

const results = await Promise.all(engines.map(run));
let failed = false;
for (const { engine, code, output } of results) {
  const summary = output.split("\n").filter((line) => /^\s*\d+ (pass|fail|skip)\b/.test(line)).map((line) => line.trim()).join(", ");
  if (code === 0) {
    console.log(`ui suites on ${engine}: ${summary}`);
  } else {
    failed = true;
    console.error(`ui suites on ${engine} failed (${summary})\n${output}`);
  }
}
if (failed) process.exit(1);
