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
  await run("anchors", async () => {
    await resize(1280);
    await goto("/docs/examples#linked-charts", "blazeplot-docs");
    await wait("page.activeElement?.id === 'linked-charts'");
    await check("page.querySelector('#linked-charts').getBoundingClientRect().top >= 60", "deep link clears sticky header");
    await js("page.querySelector('a[href=\"#basic-line-chart\"]').click()");
    await wait("location.hash === '#basic-line-chart' && page.activeElement?.id === 'basic-line-chart'");
    await js("history.back()");
    await wait("location.hash === '#linked-charts' && page.activeElement?.id === 'linked-charts'");
    await goto("/docs/docs-map", "blazeplot-docs");
    await js("page.querySelector('a[href=\"/docs/examples#linked-charts\"]').click()");
    await wait("location.pathname === '/docs/examples' && location.hash === '#linked-charts'");
    await wait("page.activeElement?.id === 'linked-charts'");
  });
  await run("live-state", async () => {
    await resize(1280);
    await goto("/", "blazeplot-home");
    await check("page.querySelector('[data-home-live-state]').textContent === 'Live'", "home starts live");
    const rect = await js("(() => { const r = page.querySelector('canvas').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()") as {x: number; y: number};
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", ...rect, deltaX: 0, deltaY: -180 });
    await wait("page.querySelector('[data-home-live-state]').textContent === 'Exploring history'");
    await js("page.querySelector('[data-home-resume]').click()");
    await wait("page.querySelector('[data-home-live-state]').textContent === 'Live'");
    await js("page.querySelector('#homeDataMode').value = 'static'; page.querySelector('#homeDataMode').dispatchEvent(new Event('change'))");
    await wait("!page.querySelector('[data-home-live-state]')");
    await check("page.querySelectorAll('canvas').length === 1", "switching data mode replaces the chart cleanly");
  });
  await run("toolbar", async () => {
    await resize(390);
    await goto("/previews/live", "blazeplot-previews");
    await check("!page.querySelector('[data-live-advanced]').open", "advanced controls initially collapsed");
    await check("!page.querySelector('[data-live-stream]').closest('details')", "stream control remains immediately available");
    await js("page.querySelector('[data-live-advanced] summary').click()");
    await check("page.querySelector('[data-live-theme]').checkVisibility()", "advanced settings are available on expansion");
    await js("page.querySelector('[data-live-theme]').value = 'light'; page.querySelector('[data-live-theme]').dispatchEvent(new Event('change'))");
    await check("page.querySelector('[data-live-preview-root]').dataset.previewTheme === 'light'", "theme still works inside advanced settings");
    await check("document.documentElement.scrollWidth <= innerWidth", "expanded controls fit a phone");
  });
  await run("preview-context", async () => {
    await resize(390);
    await goto("/previews/mobile", "blazeplot-previews");
    await check("page.querySelector('h1').textContent === 'Mobile' && page.querySelector('header p').textContent.includes('pinch')", "mobile demo explains gestures");
    await check("page.querySelector('header a').getAttribute('href') === '/docs/theming-and-layout'", "preview links to its guide");
    await goto("/previews/linked", "blazeplot-previews");
    await check("page.querySelector('header a').getAttribute('href') === '/docs/examples#linked-charts'", "guide includes relevant section");
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
