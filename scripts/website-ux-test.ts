#!/usr/bin/env bun
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CdpClient, createTarget, evaluate, resolveChrome, sleep, waitForHttp } from "./browser-harness.js";

const only = process.argv[2];
const port = 5197;
const debugPort = 9397;
const base = `http://127.0.0.1:${port}`;
const profile = await mkdtemp(join(tmpdir(), "blazeplot-website-"));
const server = Bun.spawn(["bunx", "vite", "--config", "vite.pages.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort", "--open", "false"], { stdout: "ignore", stderr: "ignore", env: { ...process.env, BLAZEPLOT_PAGES_BASE: "/" } });
let chrome: Bun.Subprocess | undefined;
let cdp: CdpClient;
const errors: string[] = [];
try {
  await waitForHttp(base, 30_000);
  chrome = Bun.spawn([resolveChrome(undefined), "--headless=new", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "--no-sandbox", "--disable-dev-shm-usage", "--no-first-run", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "about:blank"], { stdout: "ignore", stderr: "ignore" });
  await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`, 30_000);
  const target = await createTarget(debugPort, "about:blank");
  cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  cdp.on("Runtime.exceptionThrown", (error) => errors.push(JSON.stringify(error)));
  await run("responsive", async () => {
    for (const width of [390, 1280]) {
      await resize(width);
      for (const route of ["live", "sensor", "features", "histogram", "linked", "server-sampled", "flamechart", "render-loop", "mobile"]) {
        await goto(`/previews/${route}`, "blazeplot-previews");
        await check(`document.documentElement.scrollWidth <= innerWidth && [...page.querySelectorAll('[data-preview-chart]')].every(el => { const r = el.getBoundingClientRect(); return r.width === 0 || (r.left >= 0 && r.right <= innerWidth + 1); })`, `${route} fits ${width}px viewport`);
        if (route === "mobile" || route === "live") await screenshot(`${route}-${width}`);
      }
    }
  });
  // CASES
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Website UX checks passed.");
  cdp.close();
} finally {
  chrome?.kill();
  server.kill();
  if (chrome) await chrome.exited;
  await server.exited;
  await rm(profile, { recursive: true, force: true });
}

async function run(name: string, fn: () => Promise<void>): Promise<void> {
  if (only && only !== name) return;
  await fn();
  console.log(`✓ ${name}`);
}
async function resize(width: number): Promise<void> {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
}
async function js(expression: string): Promise<unknown> { return evaluate(cdp, expression, true); }
async function wait(expression: string): Promise<void> {
  const end = Date.now() + 15_000;
  while (Date.now() < end) {
    if (await js(`Boolean(${expression})`)) return;
    await sleep(50);
  }
  throw new Error(`Timed out: ${expression}`);
}
async function goto(path: string, component: string): Promise<void> {
  await cdp.send("Page.navigate", { url: base + path });
  await wait(`document.querySelector('blazeplot-site')?.shadowRoot?.querySelector('${component}')?.shadowRoot`);
  await js(`window.site = document.querySelector('blazeplot-site'); window.pageHost = site.shadowRoot.querySelector('${component}'); window.page = pageHost.shadowRoot; void 0`);
  await wait(`page.querySelector('canvas, article, [role="alert"]')`);
  await js("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
}
async function check(expression: string, message: string): Promise<void> {
  if (!await js(expression)) throw new Error(message);
}
async function screenshot(name: string): Promise<void> {
  await mkdir("build/website-ux", { recursive: true });
  const result = await cdp.send("Page.captureScreenshot", { format: "png" }) as { data: string };
  await Bun.write(`build/website-ux/${name}.png`, Buffer.from(result.data, "base64"));
}
