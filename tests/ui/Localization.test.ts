import { describe, expect, it } from "bun:test";
import { a11yPlugin } from "../../src/plugins/a11y.ts";
import { annotationsPlugin } from "../../src/plugins/annotations.ts";
import { interactionsPlugin } from "../../src/plugins/interactions.ts";
import { navigatorPlugin } from "../../src/plugins/navigator.ts";
import { legendPlugin } from "../../src/plugins/legend.ts";
import { selectionPlugin } from "../../src/plugins/selection.ts";
import { fire, keyEvent, useChartHarness, wheelEvent } from "./harness.ts";

const h = useChartHarness();

describe("localizable strings", () => {
  it("replaces legend strings", () => {
    const chart = h.make({
      plugins: [legendPlugin({ messages: { ariaLabel: "Legende", hide: (n) => `${n} ausblenden`, show: (n) => `${n} einblenden`, seriesName: (m, i) => `${m}-${i}` } })],
    });
    chart.addLine({ capacity: 4 });
    const legend = chart.rootElement.querySelector(".blazeplot-legend") as HTMLElement;
    expect(legend.getAttribute("aria-label")).toBe("Legende");
    expect((legend.children[0] as HTMLElement).title).toBe("line-0 ausblenden");
    chart.dispose();
  });

  it("replaces core summary and label strings and honors the number locale", () => {
    const chart = h.make({
      accessibility: {
        locale: "de-DE",
        messages: {
          defaultLabel: "Diagramm",
          summary: {
            noSeries: "Diagramm ohne Daten.",
            intro: (_mode, count) => `Diagramm mit ${count} Reihen.`,
            points: (count) => `${count.toLocaleString("de-DE")} Punkte`,
            seriesLine: (name, facts) => `${name}: ${facts.join("; ")}.`,
            xRange: (from, to) => `X von ${from} bis ${to}.`,
            valueRange: (from, to) => `Werte von ${from} bis ${to}`,
            latest: (y, x) => `zuletzt ${y} bei ${x}`,
          },
        },
      },
    });
    expect(chart.rootElement.getAttribute("aria-label")).toBe("Diagramm");
    expect(chart.getSummary().text).toBe("Diagramm ohne Daten.");
    const series = chart.addLine({ capacity: 2_000, name: "A" });
    for (let i = 0; i < 1_500; i++) series.append({ x: i, y: i });
    const { text } = chart.getSummary();
    expect(text).toContain("Diagramm mit 1 Reihen.");
    expect(text).toContain("1.500 Punkte");
    expect(text).not.toMatch(/\b(Chart|series|points|latest|values)\b/);
    chart.dispose();
  });

  it("replaces every a11y plugin string", () => {
    const plugin = a11yPlugin({
      locale: "de-DE",
      messages: {
        instructions: "Tastatur",
        noPointsInView: (n) => `${n}: leer`,
        tableCaption: (n, shown, visible, sampled) => `${n}: ${shown}/${visible}${sampled ? " gesampelt" : ""}`,
        xHeader: "Zeit",
        yHeader: "Wert",
        noValue: (n) => `${n}: kein Wert`,
        inspection: (n, x, y, pos, total) => `${n} ${x} ${y} ${pos}/${total}`,
        noPointsToInspect: "Keine Punkte",
        noVisibleSeries: "Keine Reihe",
        stoppedInspecting: "Gestoppt",
      },
    });
    const chart = h.make({ plugins: [plugin] });
    chart.setViewport({ xMin: 0, xMax: 10, yMin: 0, yMax: 100 });
    const empty = chart.addLine({ capacity: 4, name: "Leer" });
    void empty;
    plugin.refresh();
    const root = chart.rootElement.querySelector(".blazeplot-a11y") as HTMLElement;
    expect(root.textContent).toContain("Tastatur");
    expect(root.textContent).toContain("Leer: leer");
    const series = chart.addLine({ capacity: 4_096, name: "Reihe" });
    for (let i = 0; i < 11; i++) series.append({ x: i, y: i });
    plugin.refresh();
    expect(root.textContent).toContain("Reihe: 11/11");
    expect(root.querySelector("th")!.textContent).toBe("Zeit");
    expect(root.textContent).not.toMatch(/Keyboard|evenly sampled|visible points/);
    fire(chart.rootElement, keyEvent("Enter"));
    fire(chart.rootElement, keyEvent("Escape"));
    expect(chart.rootElement.querySelector(".blazeplot-a11y-announcer")!.textContent).toContain("Gestoppt");
    chart.dispose();
  });

  it("replaces selection announcements", () => {
    const selection = selectionPlugin({
      mode: "xy",
      messages: {
        cleared: "Auswahl geloescht",
        cancelled: "Auswahl abgebrochen",
        selecting: (description, starting) => `Waehle ${description}${starting ? " (Enter bestaetigt)" : ""}`,
        selected: (description) => `Gewaehlt ${description}`,
        xRange: (from, to) => `X von ${from} bis ${to}`,
        yRange: (from, to) => `Y von ${from} bis ${to}`,
        join: (x, y) => `${x}; ${y}`,
      },
    });
    const chart = h.make({ plugins: [selection] });
    chart.setViewport({ xMin: 0, xMax: 100, yMin: 0, yMax: 100 });
    expect(chart.rootElement.querySelector(".blazeplot-selection-brush")).not.toBeNull();
    const status = (): string => (chart.rootElement.querySelector(".blazeplot-selection-status")?.textContent ?? "").replace(/[\s ]+$/, "");
    const press = (key: string, shiftKey = false): void => { fire(chart.rootElement, keyEvent(key, { shiftKey })); };

    press("ArrowRight", true);
    expect(status()).toMatch(/^Waehle X von [\d.]+ bis [\d.]+; Y von [\d.]+ bis [\d.]+ \(Enter bestaetigt\)$/);
    press("ArrowRight", true);
    expect(status()).toMatch(/^Waehle X von .*; Y von .*$/);
    expect(status()).not.toContain("Enter bestaetigt");
    press("ArrowDown", true);
    press("Enter");
    expect(status()).toMatch(/^Gewaehlt X von [\d.]+ bis [\d.]+; Y von [\d.]+ bis [\d.]+$/);
    // A pending keyboard range that is cancelled keeps the committed selection and announces the cancellation.
    press("ArrowRight", true);
    press("Escape");
    expect(status()).toBe("Auswahl abgebrochen");
    // Clearing the committed selection is announced too.
    selection.clear();
    expect(status()).toBe("Auswahl geloescht");
    expect(status()).not.toMatch(/Selection|Selecting|Selected/);
    chart.dispose();
  });

  it("localizes the navigator label and value text, and formats the range like the X axis", () => {
    const chart = h.make({ axes: { x: { scale: "time", timezone: "utc" } }, plugins: [navigatorPlugin({ messages: { label: "Navigator", visibleRange: (from, to) => `Bereich ${from} bis ${to}` } })] });
    const series = chart.addLine({ capacity: 64 });
    const start = Date.UTC(2026, 0, 1);
    for (let i = 0; i < 20; i++) series.append({ x: start + i * 86_400_000, y: i });
    chart.setViewport({ xMin: start + 2 * 86_400_000, xMax: start + 6 * 86_400_000 });
    const root = chart.rootElement.querySelector(".blazeplot-navigator") as HTMLElement;
    expect(root.getAttribute("aria-label")).toBe("Navigator");
    const text = root.getAttribute("aria-valuetext") ?? "";
    expect(text).toMatch(/^Bereich .+ bis .+$/);
    // A time axis reads as dates, not epoch milliseconds.
    expect(text).not.toMatch(/\d{12,}/);
    chart.dispose();
  });

  it("lets navigator label and formatValueText override the messages", () => {
    const chart = h.make({ plugins: [navigatorPlugin({ label: "Zeitfenster", formatValueText: (range) => `${range.xMin}-${range.xMax}` })] });
    chart.addLine({ capacity: 8 }).append({ x: [0, 10], y: [0, 1] });
    chart.setViewport({ xMin: 2, xMax: 5 });
    const root = chart.rootElement.querySelector(".blazeplot-navigator") as HTMLElement;
    expect(root.getAttribute("aria-label")).toBe("Zeitfenster");
    expect(root.getAttribute("aria-valuetext")).toBe("2-5");
    chart.dispose();
  });

  it("localizes annotation names and the role description", () => {
    const chart = h.make({
      plugins: [
        annotationsPlugin({
          annotations: [
            { type: "x-line", x: 5 },
            { type: "box", xMin: 1, xMax: 2, yMin: 3, yMax: 4 },
            { type: "point", x: 6, y: 1, ariaLabel: "Eigen" },
          ],
          messages: { roleDescription: "Anmerkung", xLine: (x) => `Senkrechte bei ${x}`, box: (a, b, c, d) => `Kasten ${a}-${b} / ${c}-${d}` },
        }),
      ],
    });
    chart.setViewport({ xMin: 0, xMax: 10, yMin: 0, yMax: 10 });
    chart.start();
    h.raf.flush();
    const targets = [...chart.rootElement.querySelectorAll<HTMLElement>(".blazeplot-annotation-focus")];
    expect(targets.map((target) => target.getAttribute("aria-label"))).toEqual(["Senkrechte bei 5", "Kasten 1-2 / 3-4", "Eigen"]);
    expect(targets.every((target) => target.getAttribute("aria-roledescription") === "Anmerkung")).toBe(true);
    chart.dispose();
  });

  it("localizes the cooperative-gesture hint, with gestureHint text taking precedence", () => {
    const chart = h.make({ plugins: [interactionsPlugin({ wheelZoom: "modifier", messages: { wheelHint: (key) => `Mit ${key} scrollen zum Zoomen`, touchHint: "Zwei Finger benutzen" } })] });
    fire(chart.rootElement.querySelector("canvas") ?? chart.rootElement, wheelEvent(100, 100, { deltaY: 10 }));
    const hint = chart.rootElement.querySelector(".blazeplot-gesture-hint") as HTMLElement;
    expect(hint.textContent).toMatch(/^Mit (Ctrl|⌘) scrollen zum Zoomen$/);
    chart.dispose();

    const overridden = h.make({ plugins: [interactionsPlugin({ wheelZoom: "modifier", messages: { wheelHint: () => "ignored" }, gestureHint: { wheelText: "Strg + Rad" } })] });
    fire(overridden.rootElement.querySelector("canvas") ?? overridden.rootElement, wheelEvent(100, 100, { deltaY: 10 }));
    expect((overridden.rootElement.querySelector(".blazeplot-gesture-hint") as HTMLElement).textContent).toBe("Strg + Rad");
    overridden.dispose();
  });
});
