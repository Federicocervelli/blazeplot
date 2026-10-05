#!/usr/bin/env bun
/**
 * Runs axe-core against the chart DOM of the browser fixtures (tests/browser/) in headless Chrome and
 * fails on serious or critical violations. Checks the chart roots and body-mounted tooltips only, not
 * the fixture page chrome. Part of `bun run test:browser`.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CdpClient, closeTarget, createTarget, evaluate, parseTestRenderer, readPositiveInteger, resolveChrome, sleep, spawnChrome, startVite, testRendererFromEnv, waitForHttp, withTestRenderer } from "./browser-harness.js";
import type { TestRenderer } from "./browser-harness.js";

interface Options {
  port: number;
  debugPort: number;
  timeoutMs: number;
  url?: string;
  chrome?: string;
  /** Engine the fixture charts use (`--renderer` or `BLAZEPLOT_TEST_RENDERER`); the fixture's WebGL2 default when unset. */
  renderer?: TestRenderer;
}

interface AxePage {
  readonly label: string;
  readonly path: string;
  readonly fixture: "interaction" | "visual";
  /** Focus the chart and press Enter so the inspection cursor, tooltip, and crosshair are on screen. */
  readonly inspect?: boolean;
}

interface AxeViolation {
  readonly id: string;
  readonly impact: string | null;
  readonly help: string;
  readonly targets: readonly string[];
}

const FAILING_IMPACTS = new Set(["serious", "critical"]);

const PAGES: readonly AxePage[] = [
  { label: "all keyboard plugins", path: "/interaction/?case=a11y", fixture: "interaction" },
  { label: "all keyboard plugins, inspecting", path: "/interaction/?case=a11y", fixture: "interaction", inspect: true },
  ...["line", "axes-title-grid", "legend", "tooltip", "crosshair", "annotations", "selection", "navigator", "flamegraph", "overlay-layering"]
    .map((name): AxePage => ({ label: `visual ${name}`, path: `/visual/?case=${name}`, fixture: "visual" })),
];

await main();

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const serverUrl = options.url ?? `http://127.0.0.1:${options.port}`;
  const axeSource = await readFile(join(import.meta.dir, "../node_modules/axe-core/axe.min.js"), "utf8");
  let viteProc: Bun.Subprocess | null = null;
  let chromeProc: Bun.Subprocess | null = null;
  let userDataDir: string | null = null;
  const failures: string[] = [];

  try {
    if (!options.url) {
      viteProc = startVite(options.port);
      await waitForHttp(serverUrl, 30_000);
    }
    userDataDir = await mkdtemp(join(tmpdir(), "blazeplot-axe-chrome-"));
    chromeProc = spawnChrome([
      resolveChrome(options.chrome), "--headless=new", `--remote-debugging-port=${options.debugPort}`, `--user-data-dir=${userDataDir}`,
      "--window-size=900,560", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-dev-shm-usage",
      "--no-sandbox", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "about:blank",
    ]);
    await waitForHttp(`http://127.0.0.1:${options.debugPort}/json/version`, 30_000);

    for (const page of PAGES) {
      const violations = await checkPage(options, serverUrl, page, axeSource);
      const blocking = violations.filter((violation) => FAILING_IMPACTS.has(violation.impact ?? ""));
      for (const violation of violations) {
        const line = `${page.label}: [${violation.impact ?? "unknown"}] ${violation.id} - ${violation.help} (${violation.targets.join(", ")})`;
        if (FAILING_IMPACTS.has(violation.impact ?? "")) failures.push(line);
        else console.warn(`! ${line}`);
      }
      if (blocking.length === 0) console.log(`✓ axe: ${page.label} (${violations.length} minor/moderate)`);
    }
  } finally {
    if (chromeProc) chromeProc.kill();
    if (viteProc) viteProc.kill();
    if (userDataDir) await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`✗ ${failure}`);
    throw new Error(`axe found ${failures.length} serious or critical accessibility violation(s).`);
  }
}

async function checkPage(options: Options, serverUrl: string, page: AxePage, axeSource: string): Promise<AxeViolation[]> {
  const target = await createTarget(options.debugPort, withTestRenderer(new URL(page.path, serverUrl), options.renderer).toString());
  const cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
  try {
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await waitForReady(cdp, page, options.timeoutMs);
    // Let throttled summaries and data tables settle.
    await sleep(1_200);
    if (page.inspect) {
      await evaluate(cdp, "document.querySelector('.blazeplot-root')?.focus()", false);
      await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await sleep(200);
      const source = await evaluate(cdp, "document.querySelector('.blazeplot-a11y-announcer')?.textContent ?? ''", false) as string;
      if (!source.trim()) throw new Error(`${page.label}: Enter did not start keyboard inspection`);
    }
    await evaluate(cdp, `${axeSource};true`, false);
    const expression = `(() => {
      const include = [".blazeplot-root", ".blazeplot-tooltip"].filter((selector) => document.querySelector(selector)).map((selector) => [selector]);
      return axe.run({ include }, { resultTypes: ["violations"] }).then((result) => result.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact ?? null,
        help: violation.help,
        targets: violation.nodes.slice(0, 4).map((node) => node.target.join(" ")),
      })));
    })()`;
    if (page === PAGES[0]) {
      // Self-test: an unnamed button inside the chart must be reported, so a silent no-op cannot pass.
      await evaluate(cdp, "(() => { const b = document.createElement('button'); b.id = 'axe-self-test'; document.querySelector('.blazeplot-root').appendChild(b); })()", false);
      const probe = await evaluate(cdp, expression, true) as AxeViolation[];
      await evaluate(cdp, "document.getElementById('axe-self-test')?.remove()", false);
      if (!probe.some((violation) => violation.id === "button-name")) throw new Error("axe self-test failed: an unnamed button in the chart was not reported");
    }
    return await evaluate(cdp, expression, true) as AxeViolation[];
  } finally {
    cdp.close();
    await closeTarget(options.debugPort, target.id);
  }
}

async function waitForReady(cdp: CdpClient, page: AxePage, timeoutMs: number): Promise<void> {
  const controller = page.fixture === "visual" ? "__blazeplotVisualTest" : "__blazeplotInteractionTest";
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const snapshot = await evaluate(cdp, `window.${controller}?.snapshot?.() ?? null`, true) as { state?: string; error?: string | null } | null;
    if (snapshot?.state === "ready") return;
    if (snapshot?.state === "error") throw new Error(`${page.label} failed: ${snapshot.error ?? "unknown error"}`);
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${page.label}`);
}

function parseArgs(args: readonly string[]): Options {
  const parsed: Options = { port: 41739, debugPort: 9231, timeoutMs: 30_000, renderer: testRendererFromEnv() };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;
    const [flag, inlineValue] = arg.split("=", 2) as [string, string?];
    const readValue = (): string => {
      if (inlineValue !== undefined) return inlineValue;
      const next = args[++i];
      if (!next) throw new Error(`Missing value for ${flag}`);
      return next;
    };
    switch (flag) {
      case "--port": parsed.port = readPositiveInteger(flag, readValue()); break;
      case "--debug-port": parsed.debugPort = readPositiveInteger(flag, readValue()); break;
      case "--timeout-ms": parsed.timeoutMs = readPositiveInteger(flag, readValue()); break;
      case "--url": parsed.url = readValue(); break;
      case "--chrome": parsed.chrome = readValue(); break;
      case "--renderer": parsed.renderer = parseTestRenderer(readValue()); break;
      case "--help":
      case "-h":
        console.log("Usage: bun run test:a11y [--chrome <path>] [--url <fixture server>] [--renderer webgl2|canvas2d|shared|auto]\n\nRuns axe-core on the chart DOM of the browser fixtures and fails on serious or critical violations.");
        process.exit(0);
        break;
      default: throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}
