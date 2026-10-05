import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { a11yPlugin } from "../../src/plugins/a11y.ts";
import { annotationsPlugin } from "../../src/plugins/annotations.ts";
import { crosshairPlugin } from "../../src/plugins/crosshair.ts";
import { navigatorPlugin } from "../../src/plugins/navigator.ts";
import { selectionPlugin } from "../../src/plugins/selection.ts";
import { useChartHarness } from "../ui/harness.ts";
import type { ChartPlugin } from "../../src/ui/PluginTypes.ts";

/**
 * The built-in plugins are the proof that third parties can write equivalent plugins, so they may
 * only use what a third party gets: the `ChartPluginContext` passed to `install`, public types from
 * the `blazeplot` root entry, and each other. This test fails when a plugin module imports chart
 * internals (Chart, ChartLayout, Renderer, Camera2D, SeriesStore runtime, ...), imports a non-public
 * type, or reaches for the experimental `ctx.unstable` escape hatches.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const src = resolve(root, "src");

/** Pure, chart-independent helpers a plugin may import at runtime. Third parties can copy them. */
const runtimeHelpers: Record<string, readonly string[]> = {
  "src/ui/theme.ts": ["rgbaCss"],
};

/** `ctx.unstable` members a built-in plugin may use; everything else must stay on the stable context. */
const unstableAllowance: Record<string, readonly string[]> = {
  "src/ui/FlameGraph.ts": ["createRenderSurface"],
};

/** Shared plugin-side helper modules that are not themselves package entries. */
/** Leaf type modules every plugin may import types from (public plugin and chart-state types). */
const typeModules: readonly string[] = ["src/ui/PluginTypes.ts", "src/ui/ChartEvents.ts", "src/ui/ChartViewportTypes.ts"];

const pluginHelpers = ["src/ui/OverlayUtils.ts", "src/ui/PickOverlay.ts"];

interface ImportRecord {
  readonly specifier: string;
  readonly resolved: string | null;
  readonly typeOnly: boolean;
  readonly names: readonly { readonly name: string; readonly typeOnly: boolean }[];
  readonly text: string;
}

const rel = (file: string): string => relative(root, file).replaceAll("\\", "/");

function resolveSpecifier(from: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  return rel(resolve(dirname(from), specifier.replace(/\.js$/, ".ts")));
}

function parseImports(file: string): ImportRecord[] {
  const source = readFileSync(file, "utf8");
  const records: ImportRecord[] = [];
  const pattern = /^(?:import|export)\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["'];?/gm;
  for (const match of source.matchAll(pattern)) {
    const [text, typeKeyword, clause = "", specifier = ""] = match;
    const braces = /\{([\s\S]*)\}/.exec(clause)?.[1];
    const names = braces
      ? braces.split(",").map((part) => part.trim()).filter(Boolean).map((part) => {
          const typeOnly = part.startsWith("type ");
          const name = part.replace(/^type\s+/, "").split(/\s+as\s+/)[0]!.trim();
          return { name, typeOnly };
        })
      : [{ name: clause.trim(), typeOnly: false }];
    records.push({ specifier, resolved: resolveSpecifier(file, specifier), typeOnly: typeKeyword !== undefined, names, text: text.trim() });
  }
  return records;
}

/** Every name exported from the `blazeplot` root entry. */
function publicRootNames(): Set<string> {
  const names = new Set<string>();
  for (const record of parseImports(resolve(src, "index.ts"))) {
    for (const { name } of record.names) names.add(name);
  }
  return names;
}

/** Plugin entries plus the implementation modules they re-export and the shared helpers. */
function pluginModules(): Set<string> {
  const modules = new Set<string>(pluginHelpers);
  const entriesDir = resolve(src, "plugins");
  for (const entry of readdirSync(entriesDir).filter((name) => name.endsWith(".ts"))) {
    const file = resolve(entriesDir, entry);
    modules.add(rel(file));
    for (const record of parseImports(file)) if (record.resolved) modules.add(record.resolved);
  }
  return modules;
}

const modules = pluginModules();
const publicNames = publicRootNames();

describe("built-in plugin boundary", () => {
  it("covers every built-in plugin implementation", () => {
    for (const name of ["A11y", "Annotations", "Crosshair", "FlameGraph", "Interactions", "Legend", "Navigator", "Selection", "Tooltip"]) {
      expect(modules.has(`src/ui/${name}.ts`)).toBe(true);
    }
  });

  for (const module of [...modules].sort()) {
    it(`${module} imports only public types, runtime helpers, and other plugin modules`, () => {
      const violations: string[] = [];
      for (const record of parseImports(resolve(root, module))) {
        const target = record.resolved;
        if (target === null) {
          violations.push(`${record.text} (bare import)`);
          continue;
        }
        if (modules.has(target)) continue;
        if (typeModules.includes(target) && (record.typeOnly || record.names.every((n) => n.typeOnly))) continue;

        const helperNames = runtimeHelpers[target];
        for (const { name, typeOnly } of record.names) {
          if (name === "Chart") {
            violations.push(`${record.text} (plugins receive ChartPluginContext, not Chart)`);
          } else if (record.typeOnly || typeOnly) {
            if (!publicNames.has(name)) violations.push(`${record.text} (type ${name} is not exported from "blazeplot")`);
          } else if (!helperNames?.includes(name)) {
            violations.push(`${record.text} (runtime import of ${name} from a chart module)`);
          }
        }
      }
      expect(violations).toEqual([]);
    });

    it(`${module} stays on the stable context surface`, () => {
      const source = readFileSync(resolve(root, module), "utf8");
      // The flame graph is the first customer of the experimental render surface, so its rectangle layer follows the chart's engine.
      const allowed = unstableAllowance[module] ?? [];
      const unstableUses = [...source.matchAll(/\.unstable\.(\w+)/g)].map((match) => match[1]!).filter((name) => !allowed.includes(name));
      expect(unstableUses).toEqual([]);
      expect(source.match(/\.unstable\b(?!\.\w)/g) ?? []).toEqual([]);
      expect(source.match(/\bas\s+Chart\b/g) ?? []).toEqual([]);
    });
  }
});

describe("plugin instances are per chart", () => {
  const h = useChartHarness();
  // flameGraph shares the same guard but needs a WebGL2 context, so it is not constructed here.
  const factories: Record<string, () => ChartPlugin> = {
    a11y: () => a11yPlugin(),
    annotations: () => annotationsPlugin(),
    crosshair: () => crosshairPlugin(),
    navigator: () => navigatorPlugin(),
    selection: () => selectionPlugin(),
  };

  for (const [name, create] of Object.entries(factories)) {
    it(`${name} throws a descriptive error when one instance is installed on a second chart`, () => {
      const plugin = create();
      const first = h.make({ plugins: [plugin] });
      expect(() => h.make({ plugins: [plugin] })).toThrow(/one plugin instance per chart/);
      // The failed install left the first chart untouched, and disposing it frees the instance.
      first.dispose();
      const again = h.make({ plugins: [plugin] });
      again.dispose();
    });
  }
});
