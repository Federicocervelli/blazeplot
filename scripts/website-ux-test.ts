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
  await run("home", async () => {
    await resize(390);
    await goto("/", "blazeplot-home");
    await check("!page.querySelector('article') && page.textContent.includes('npm install blazeplot')", "homepage has focused installation content");
    await check("page.querySelector('a[href=\"/docs/overview\"]').textContent === 'Get started'", "clear onboarding action");
    await js("page.querySelector('a[href=\"/docs/overview#quick-start\"]').click()");
    await wait("site.shadowRoot.querySelector('blazeplot-docs')?.shadowRoot?.activeElement?.id === 'quick-start'");
  });
  await run("navigation", async () => {
    await resize(320);
    await goto("/docs/overview", "blazeplot-docs");
    await check("(() => { const nav = site.shadowRoot.querySelector('blazeplot-topbar').shadowRoot; return [...nav.querySelectorAll('nav a')].every(a => a.getAttribute('aria-label') || a.textContent.trim()) && nav.querySelector('a[aria-current=page]').textContent.trim() === 'Docs'; })()", "primary links retain accessible labels and active state");
    await check("document.documentElement.scrollWidth <= innerWidth", "navigation fits 320px viewport");
    await check("site.shadowRoot.querySelector('footer').textContent.includes('Portfolio')", "secondary links remain available in footer");
  });
  await run("drawers", async () => {
    for (const [route, component] of [["/docs/overview", "blazeplot-docs"], ["/previews/mobile", "blazeplot-previews"]]) {
      await resize(390);
      await goto(route!, component!);
      await js("window.trigger = site.shadowRoot.querySelector('blazeplot-topbar').shadowRoot.querySelector('button'); trigger.focus(); trigger.click()");
      await wait("page.querySelector('site-drawer').shadowRoot.querySelector('dialog').open");
      await check("document.body.style.overflow === 'hidden'", "modal prevents background scrolling");
      for (let i = 0; i < 20; i++) await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      await check("page.activeElement === page.querySelector('site-drawer') || page.querySelector('site-drawer').contains(page.activeElement)", "tab focus remains in drawer");
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await wait("!page.querySelector('site-drawer').shadowRoot.querySelector('dialog').open");
      await check("document.body.style.overflow === '' && trigger.getRootNode().activeElement === trigger", "escape restores scrolling and focus");
      await js("trigger.click()");
      await wait("page.querySelector('site-drawer').shadowRoot.querySelector('dialog').open");
      await resize(1280);
      await wait("!page.querySelector('site-drawer').shadowRoot.querySelector('dialog').open");
    }
  });
  await run("copy-contents", async () => {
    await goto("/docs/overview", "blazeplot-docs");
    await js("Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copied = text; } } }); page.querySelector('[data-copy-code]').click()");
    await wait("page.querySelector('.code-toolbar [role=status]').textContent === 'Copied'");
    await check("window.copied === page.querySelector('.code-block code').textContent", "copy preserves exact code without toolbar text");
    await js("navigator.clipboard.writeText = async () => { throw new Error('denied'); }; page.querySelector('[data-copy-code]').click()");
    await wait("page.querySelector('.code-toolbar [role=status]').textContent.includes('Could not copy')");
    await check("[...page.querySelectorAll('.doc-toc a')].every(a => page.getElementById(a.hash.slice(1)))", "all generated contents links resolve");
  });
  await run("feedback", async () => {
    await goto("/previews/live", "blazeplot-previews");
    await js("Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } }); page.querySelector('[data-live-copy]').click()");
    await wait("page.querySelector('[data-live-action-status]').textContent.includes('Could not copy')");
    await js("navigator.clipboard.writeText = async () => {}; page.querySelector('[data-live-copy]').click()");
    await wait("page.querySelector('[data-live-action-status]').textContent === 'Stats copied'");
    await js("window.originalBlob = HTMLCanvasElement.prototype.toBlob; HTMLCanvasElement.prototype.toBlob = function() { throw new Error('export failed'); }; page.querySelector('[data-live-screenshot]').click()");
    await wait("page.querySelector('[data-live-action-status]').textContent.includes('Could not export')");
    await js("HTMLCanvasElement.prototype.toBlob = window.originalBlob; page.querySelector('[data-live-screenshot]').click()");
    await wait("page.querySelector('[data-live-action-status]').textContent === 'Screenshot download started'");
    for (const unavailable of [true, false]) {
      const script = await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `HTMLCanvasElement.prototype.getContext = function() { ${unavailable ? "return null" : "throw new Error('Unexpected initialization failure')"}; };` }) as { identifier: string };
      await goto("/", "blazeplot-home");
      await check(`page.querySelector('[role=alert]').textContent.includes('${unavailable ? "WebGL2" : "could not start"}')`, "fallback explains the actual failure category");
      await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: script.identifier });
    }
  });
  await run("lazy-loading", async () => {
    await goto("/", "blazeplot-home");
    await check("!performance.getEntriesByType('resource').some(r => ['/previews/', 'docs-page', 'examples.md', 'FlameGraph'].some(part => r.name.includes(part)))", "home does not load preview or docs implementations");
    await goto("/previews/mobile", "blazeplot-previews");
    await check("!performance.getEntriesByType('resource').some(r => ['flamechart', 'histogram', 'server-sampled', 'live'].some(id => r.name.includes('/previews/' + id + '.ts')))", "mobile loads only its own demo");
    await goto("/docs/overview", "blazeplot-docs");
    await check("!performance.getEntriesByType('resource').some(r => r.name.includes('examples.md'))", "docs load only the selected markdown");
    await js("page.querySelector('a[href=\"/docs/examples\"]').click(); site.shadowRoot.querySelector('blazeplot-topbar').shadowRoot.querySelector('a[href=\"/previews\"]').click()");
    await wait("site.shadowRoot.querySelector('blazeplot-previews')?.shadowRoot?.querySelector('canvas')");
    await check("!site.shadowRoot.querySelector('blazeplot-docs')", "rapid navigation does not resurrect a stale page");
  });
  await run("visible-doc-charts", async () => {
    await resize(1280);
    await goto("/docs/examples", "blazeplot-docs");
    await check("page.querySelectorAll('canvas').length < page.querySelectorAll('[data-doc-chart]').length", "offscreen examples are not eagerly mounted");
    await js("window.draws = new WeakMap(); for (const name of ['drawArrays', 'drawArraysInstanced']) { const original = WebGL2RenderingContext.prototype[name]; WebGL2RenderingContext.prototype[name] = function(...args) { draws.set(this.canvas, (draws.get(this.canvas) || 0) + 1); return original.apply(this, args); }; } page.querySelector('[data-doc-chart=live-line]').scrollIntoView({behavior:'instant', block:'center'})");
    await wait("page.querySelector('[data-doc-chart=live-line] canvas')");
    await js("window.liveCanvas = page.querySelector('[data-doc-chart=live-line] canvas'); void 0");
    await wait("draws.get(liveCanvas) > 5");
    await js("window.scrollTo({top:0, behavior:'instant'})");
    await sleep(300);
    const stopped = await js("draws.get(liveCanvas)");
    await sleep(350);
    await check(`draws.get(liveCanvas) === ${stopped}`, "offscreen live chart stops GPU draws");
    await js("page.querySelector('[data-doc-chart=live-line]').scrollIntoView({behavior:'instant', block:'center'})");
    await wait(`draws.get(liveCanvas) > ${stopped}`);
    await check("page.querySelector('[data-doc-chart=live-line] canvas') === liveCanvas", "returning preserves the existing chart");
    await js("site.shadowRoot.querySelector('blazeplot-topbar').shadowRoot.querySelector('a[href=\"/docs/overview\"]').click()");
    await wait("!liveCanvas.isConnected");
    await sleep(150);
    const disposed = await js("draws.get(liveCanvas)");
    await sleep(300);
    await check(`draws.get(liveCanvas) === ${disposed}`, "leaving docs disposes chart activity");
  });
  await run("follow-helper", async () => {
    await resize(1280);
    await goto("/", "blazeplot-home");
    for (const mode of ["line", "multi", "ohlc"]) {
      await js(`page.querySelector('#homeChartMode').value = '${mode}'; page.querySelector('#homeChartMode').dispatchEvent(new Event('change'))`);
      await wait("pageHost.homeChart?.isFollowingLatestX()");
      await check("Math.abs((pageHost.homeChart.getViewport().xMax - pageHost.homeChart.getViewport().xMin) - 419) < 0.01", "live window retains its original span");
      await js("pageHost.homeChart.pan({dx:0.1,dy:0})");
      await wait("page.querySelector('[data-home-live-state]').textContent === 'Exploring history'");
      await js("page.querySelector('[data-home-resume]').click()");
      await wait("pageHost.homeChart.isFollowingLatestX() && page.querySelector('[data-home-live-state]').textContent === 'Live'");
      await check("Number.isFinite(pageHost.homeChart.getViewport().yMin)", "each chart mode retains a valid Y range");
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
  await wait(`page.querySelector('canvas, article h1, article h2, [role="alert"]')`);
  await js("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
}
async function check(expression: string, message: string): Promise<void> {
  if (!await js(expression)) throw new Error(message + " " + JSON.stringify(await js("({active:document.activeElement?.tagName, pageActive:window.page?.activeElement?.outerHTML, dialog:window.page?.querySelector(\"site-drawer\")?.shadowRoot?.activeElement?.outerHTML})")));
}
async function screenshot(name: string): Promise<void> {
  await mkdir("build/website-ux", { recursive: true });
  const result = await cdp.send("Page.captureScreenshot", { format: "png" }) as { data: string };
  await Bun.write(`build/website-ux/${name}.png`, Buffer.from(result.data, "base64"));
}
