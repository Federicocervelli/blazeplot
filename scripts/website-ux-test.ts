#!/usr/bin/env bun
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CdpClient, createTarget, evaluate, resolveChrome, sleep, waitForHttp } from "./browser-harness.js";

const only = process.argv[2];
const port = await freePort();
const debugPort = await freePort();
const base = `http://127.0.0.1:${port}${(process.env.BLAZEPLOT_PAGES_BASE ?? "/").replace(/\/$/, "")}`;
const profile = await mkdtemp(join(tmpdir(), "blazeplot-website-"));
const server = Bun.spawn(["node", "node_modules/vite/bin/vite.js", ...(only === "production" ? ["preview"] : []), "--config", "vite.pages.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort", "--open", "false"], { stdout: "ignore", stderr: "ignore", env: { ...process.env, BLAZEPLOT_WEBSITE_TEST: "1", BLAZEPLOT_PAGES_BASE: process.env.BLAZEPLOT_PAGES_BASE ?? "/" } });
let chrome: Bun.Subprocess | undefined;
let cdp!: CdpClient;
const errors: string[] = [];
const pendingRequests = new Map<string, string>();
let navigation = 0;
let tabId: string | null = null;
let viewportWidth = 1280;
try {
  await waitForHttp(base, 30_000);
  chrome = Bun.spawn([resolveChrome(undefined), "--headless=new", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, "--no-sandbox", "--disable-dev-shm-usage", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", "--no-first-run", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "about:blank"], { stdout: "ignore", stderr: "ignore" });
  await waitForHttp(`http://127.0.0.1:${debugPort}/json/version`, 30_000);
  await openTab();
  await run("responsive", async () => {
    for (const width of [390, 1280]) {
      await resize(width);
      for (const route of ["live", "sensor", "features", "histogram", "linked", "server-sampled", "flamechart", "render-loop", "mobile"]) {
        console.log(`  checking ${route} at ${width}px`);
        await goto(`/previews/${route}`, "blazeplot-previews");
        await check(`document.documentElement.scrollWidth <= innerWidth && [...page.querySelectorAll('[data-preview-chart]')].every(el => { const r = el.getBoundingClientRect(); return r.width === 0 || (r.left >= 0 && r.right <= innerWidth + 1); })`, `${route} fits ${width}px viewport`);
        await check("getComputedStyle(site.shadowRoot.querySelector('main')).overflowY !== 'auto'", "page avoids nested scrolling");
        await check("page.querySelector('h1').getBoundingClientRect().top < 180", "preview heading stays near navigation");
        if (["mobile", "live", "features"].includes(route)) await screenshot(`${route}-${width}`);
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
      await screenshot(component! + "-drawer");
      await check("document.body.style.overflow === 'hidden'", "modal prevents background scrolling");
      for (let i = 0; i < 20; i++) {
        await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
        await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
      }
      await check("page.activeElement === page.querySelector('site-drawer') || page.querySelector('site-drawer').contains(page.activeElement)", "tab focus remains in drawer");
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
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
    await screenshot("docs-overview");
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
      await goto("/", "blazeplot-home", `HTMLCanvasElement.prototype.getContext = function() { ${unavailable ? "return null" : "throw new Error('Unexpected initialization failure')"}; };`);
      await check(`page.querySelector('[role=alert]').textContent.includes('${unavailable ? "WebGL2" : "could not start"}')`, "fallback explains the actual failure category");
      await check("!page.querySelector('[data-home-live-state]')", "failed chart does not claim it is live");
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
  await run("control-styles", async () => {
    await resize(390);
    await goto("/", "blazeplot-home");
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
    await js("page.querySelector('#homeDataMode').focus()");
    await check("getComputedStyle(page.querySelector('#homeDataMode')).outlineStyle !== 'none'", "keyboard focus is visibly outlined");
    await check("getComputedStyle(page.querySelector('a[href=\"/docs/overview\"]')).borderTopStyle === 'solid'", "utility borders render inside shadow roots");
    await check("page.querySelector('#homeDataMode').getBoundingClientRect().height >= 36", "controls have usable height");
    await check("getComputedStyle(pageHost).getPropertyValue('--muted').trim() === '#aaa'", "muted text uses the shared readable token");
    await screenshot("home-polished-mobile");
  });
  await run("legend", async () => {
    await goto("/", "blazeplot-home");
    await js(`(async () => {
      const { Chart, StaticDataset } = await import('/@fs${process.cwd()}/src/index.ts');
      const { legendPlugin } = await import('/@fs${process.cwd()}/src/plugins/legend.ts');
      window.legendHost = document.createElement('div'); legendHost.style.cssText = 'width:500px;height:300px'; document.body.append(legendHost);
      window.legendChart = new Chart(legendHost, { plugins: [legendPlugin()] });
      window.legendSeries = legendChart.addLine({ dataset:new StaticDataset([0,1],[0,1]), name:'Signal' });
      legendChart.fitToData(); legendChart.start();
      window.legendButton = legendHost.querySelector('.blazeplot-legend button'); legendButton.focus();
      window.legendFactory = legendPlugin;
    })()`);
    await cdp.send("Input.dispatchKeyEvent", { type:"keyDown", key:"Enter", code:"Enter", windowsVirtualKeyCode:13, text:"\r", unmodifiedText:"\r" });
    await cdp.send("Input.dispatchKeyEvent", { type:"keyUp", key:"Enter", code:"Enter", windowsVirtualKeyCode:13 });
    await check("!legendSeries.visible && document.activeElement === legendButton && legendButton.getAttribute('aria-pressed') === 'false'", "keyboard toggle preserves focus and updates pressed state");
    await js("legendButton.click(); legendChart.setTheme({legendTextColor:'#123456'})");
    await check("legendSeries.visible && document.activeElement === legendButton && legendHost.querySelector('button') === legendButton", "repeated toggle and theme update retain the same button");
    await check("!legendButton.hasAttribute('role') && legendHost.querySelector('.blazeplot-legend').getAttribute('role') === 'group'", "native button semantics remain intact");
    await js("window.secondSeries = legendChart.addLine({capacity:10,name:'Second'}); legendChart.removeSeries(secondSeries)");
    await check("legendHost.querySelectorAll('.blazeplot-legend button').length === 1 && document.activeElement === legendButton", "adding and removing other series preserves focus");
    await js("legendChart.removeSeries(legendSeries)");
    await check("legendHost.querySelectorAll('.blazeplot-legend button').length === 0", "removed series disappear from legend");
    await js("legendChart.dispose(); legendHost.remove()");
    await js(`(async () => {
      const { Chart } = await import('/@fs${process.cwd()}/src/index.ts');
      window.legendHost = document.createElement('div'); legendHost.style.cssText = 'width:500px;height:300px'; document.body.append(legendHost);
      window.legendChart = new Chart(legendHost, { plugins: [legendFactory({toggleOnClick:false})] });
      legendChart.addLine({capacity:10,name:'Read only'});
    })()`);
    await check("legendHost.querySelector('.blazeplot-legend').textContent.includes('Read only') && !legendHost.querySelector('.blazeplot-legend button')", "noninteractive legend has no inert buttons");
    await js("legendChart.dispose(); legendHost.remove()");
  });
  if (only === "production") await run("production", async () => {
    await resize(1280);
    for (const [path, component] of [["/", "blazeplot-home"], ["/docs/overview#quick-start", "blazeplot-docs"], ["/previews/mobile", "blazeplot-previews"], ["/previews/features", "blazeplot-previews"]]) {
      await goto(path!, component!);
      await check("!page.querySelector('[role=alert]')", "production route loads without errors");
      if (component !== "blazeplot-home") await check("page.querySelector('site-drawer')?.shadowRoot?.querySelector('dialog') && !page.querySelector('site-drawer').shadowRoot.querySelector('dialog').open", "production registers and hides the closed drawer");
      if (component === "blazeplot-previews") await check("page.querySelector('h1').getBoundingClientRect().top < 180", "production preview navigation stays compact");
      if (path!.includes('#')) await wait("page.activeElement?.id === 'quick-start'");
    }
    await screenshot("production-desktop");
    await resize(390);
    await goto("/docs/overview", "blazeplot-docs");
    await js("site.shadowRoot.querySelector('blazeplot-topbar').shadowRoot.querySelector('button').click()");
    await wait("page.querySelector('site-drawer').shadowRoot.querySelector('dialog').open");
    await screenshot("production-mobile-drawer");
    await cdp.send("Input.dispatchKeyEvent", {type:"keyDown", key:"Escape", code:"Escape", windowsVirtualKeyCode:27});
    await cdp.send("Input.dispatchKeyEvent", {type:"keyUp", key:"Escape", code:"Escape", windowsVirtualKeyCode:27});
    await wait("!page.querySelector('site-drawer').shadowRoot.querySelector('dialog').open");
  });
  // CASES
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Website UX checks passed.");
  cdp.close();
} catch (error) {
  console.error("Pending requests:", [...pendingRequests.values()]);
  throw error;
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
  viewportWidth = width;
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
async function goto(path: string, component: string, initScript = ""): Promise<void> {
  await openTab();
  const url = new URL(base + path);
  url.searchParams.set("uxRun", String(++navigation));
  const marker = await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.__uxDocument = ${navigation}; ${initScript}`,
  }) as { identifier: string };
  try {
    await cdp.send("Page.navigate", { url: url.href });
    await wait(`window.__uxDocument === ${navigation} && location.href === ${JSON.stringify(url.href)} && document.querySelector('blazeplot-site')?.shadowRoot?.querySelector('${component}')?.shadowRoot`);
  } finally {
    await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: marker.identifier });
  }
  await js(`window.site = document.querySelector('blazeplot-site'); window.pageHost = site.shadowRoot.querySelector('${component}'); window.page = pageHost.shadowRoot; void 0`);
  await wait(`page.querySelector('canvas, article h1, article h2, [role="alert"]')`);
  await cdp.send("Page.bringToFront");
  await wait("[...page.querySelectorAll('canvas')].every(canvas => canvas.width > 0 && canvas.height > 0)");
  if (path === "/previews/live") await wait("!page.querySelector('[data-live-overlay-text]').textContent.includes('booting')");
}
async function check(expression: string, message: string): Promise<void> {
  if (!await js(expression)) throw new Error(message + " " + JSON.stringify(await js("({active:document.activeElement?.tagName, legendVisible:window.legendSeries?.visible, same:window.legendButton === document.activeElement, pressed:window.legendButton?.getAttribute('aria-pressed'), pageActive:window.page?.activeElement?.outerHTML, dialog:window.page?.querySelector(\"site-drawer\")?.shadowRoot?.activeElement?.outerHTML})")));
}
async function screenshot(name: string): Promise<void> {
  await mkdir("build/website-ux", { recursive: true });
  const result = await cdp.send("Page.captureScreenshot", { format: "png" }) as { data: string };
  await Bun.write(`build/website-ux/${name}.png`, Buffer.from(result.data, "base64"));
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate test port");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function openTab(): Promise<void> {
  if (tabId) {
    await fetch(`http://127.0.0.1:${debugPort}/json/close/${tabId}`);
    cdp.close();
  }
  pendingRequests.clear();
  const target = await createTarget(debugPort, "about:blank");
  tabId = target.webSocketDebuggerUrl.split("/").at(-1)!;
  cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
  const send = cdp.send.bind(cdp);
  cdp.send = (method, params) => {
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
      send(method, params),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`CDP timeout: ${method} ${String(params?.expression ?? "")}`)), 20_000); }),
    ]).finally(() => clearTimeout(timer));
  };
  await cdp.send("Network.enable");
  cdp.on("Network.requestWillBeSent", (params) => {
    const event = params as { requestId: string; request: { url: string } };
    pendingRequests.set(event.requestId, event.request.url);
  });
  for (const event of ["Network.loadingFinished", "Network.loadingFailed"]) {
    cdp.on(event, (params) => pendingRequests.delete((params as { requestId: string }).requestId));
  }
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Page.bringToFront");
  await mkdir("build/website-ux/downloads", { recursive: true });
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: join(process.cwd(), "build/website-ux/downloads") });
  cdp.on("Runtime.exceptionThrown", (error) => errors.push(JSON.stringify(error)));
  await resize(viewportWidth);
}
