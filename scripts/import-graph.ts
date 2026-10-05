/**
 * Static import graph of `src/`: used by `scripts/check-import-graph.ts` and `tests/scripts/import-graph.test.ts`
 * to keep the library acyclic and layered. Dependency free apart from the TypeScript scanner already
 * used by the other scripts. Type-only imports count: a type cycle is still a cycle.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "@typescript/typescript6";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const srcRoot = resolve(repoRoot, "src");

/** Edges keyed by repo-relative posix path (`src/ui/Chart.ts`). */
export type ImportGraph = Map<string, readonly string[]>;

const toPosix = (path: string): string => relative(repoRoot, path).replaceAll("\\", "/");

function listSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name);
    if (statSync(full).isDirectory()) listSources(full, out);
    else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

/** Resolve a relative specifier the way the bundler does: `.js` maps to `.ts`, directories to `index.ts`. */
export function resolveImport(from: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(from), specifier);
  for (const candidate of [base.replace(/\.js$/, ".ts"), `${base}.ts`, resolve(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Relative module specifiers a file imports or re-exports (static and dynamic). */
export function importSpecifiers(file: string): string[] {
  const info = ts.preProcessFile(readFileSync(file, "utf8"), true, true);
  return info.importedFiles.map((entry) => entry.fileName);
}

export function buildImportGraph(dir: string = srcRoot): ImportGraph {
  const graph: ImportGraph = new Map();
  for (const file of listSources(dir)) {
    const targets = new Set<string>();
    for (const specifier of importSpecifiers(file)) {
      const resolved = resolveImport(file, specifier);
      if (resolved) targets.add(toPosix(resolved));
    }
    graph.set(toPosix(file), [...targets].sort());
  }
  return graph;
}

/** Strongly connected components with more than one module (or a self import): the import cycles. */
export function findCycles(graph: ImportGraph): string[][] {
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];

  const visit = (node: string): void => {
    index.set(node, counter);
    low.set(node, counter);
    counter++;
    stack.push(node);
    onStack.add(node);
    for (const next of graph.get(node) ?? []) {
      if (!graph.has(next)) continue;
      if (!index.has(next)) {
        visit(next);
        low.set(node, Math.min(low.get(node)!, low.get(next)!));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node)!, index.get(next)!));
      }
    }
    if (low.get(node) === index.get(node)) {
      const component: string[] = [];
      let member: string;
      do {
        member = stack.pop()!;
        onStack.delete(member);
        component.push(member);
      } while (member !== node);
      if (component.length > 1 || (graph.get(node) ?? []).includes(node)) cycles.push(component.sort());
    }
  };

  for (const node of graph.keys()) if (!index.has(node)) visit(node);
  return cycles.sort((a, b) => a[0]!.localeCompare(b[0]!));
}

/**
 * Layering rules: a module in `from` may only import modules whose path starts with one of `allow`
 * (its own directory is always allowed). Later rules never loosen earlier ones.
 */
export interface LayerRule {
  readonly name: string;
  /** Repo-relative path prefix selecting the importing modules. */
  readonly from: string;
  /** Repo-relative path prefixes the module may import. */
  readonly allow: readonly string[];
}

export const layerRules: readonly LayerRule[] = [
  { name: "core is the data engine: it imports nothing outside core", from: "src/core/", allow: ["src/core/"] },
  { name: "interaction mutates the camera: it imports only core and interaction", from: "src/interaction/", allow: ["src/core/", "src/interaction/"] },
  { name: "render imports only core, interaction, and render", from: "src/render/", allow: ["src/core/", "src/interaction/", "src/render/"] },
  { name: "ui (Chart) never imports optional plugins or linked charts", from: "src/ui/", allow: ["src/core/", "src/interaction/", "src/render/", "src/ui/"] },
  {
    name: "plugins import only the public plugin types (ui/PluginTypes, ChartEvents, ChartViewportTypes), core, interaction, theme, and each other; never Chart",
    from: "src/plugins/",
    allow: ["src/plugins/", "src/core/", "src/interaction/", "src/ui/PluginTypes.ts", "src/ui/ChartEvents.ts", "src/ui/ChartViewportTypes.ts", "src/ui/theme.ts"],
  },
  { name: "linked charts build on the public Chart API, never on plugins' internals", from: "src/linked/", allow: ["src/linked/", "src/core/", "src/interaction/", "src/ui/"] },
];

export function findLayerViolations(graph: ImportGraph, rules: readonly LayerRule[] = layerRules): string[] {
  const violations: string[] = [];
  for (const [file, targets] of graph) {
    for (const rule of rules) {
      if (!file.startsWith(rule.from)) continue;
      for (const target of targets) {
        if (!rule.allow.some((prefix) => target.startsWith(prefix))) violations.push(`${file} -> ${target} (${rule.name})`);
      }
    }
  }
  return violations;
}
