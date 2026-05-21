import apiReference from "../../docs/api-reference.md?raw";
import browserSupport from "../../docs/browser-support.md?raw";
import builtInPlugins from "../../docs/built-in-plugins.md?raw";
import dataSemantics from "../../docs/data-semantics.md?raw";
import docsMap from "../../docs/README.md?raw";
import documentationContributions from "../../docs/documentation-contributions.md?raw";
import examples from "../../docs/examples.md?raw";
import liveData from "../../docs/live-data.md?raw";
import overview from "../../docs/overview.md?raw";
import performanceRecipes from "../../docs/performance-recipes.md?raw";
import releaseBenchmarks from "../../docs/release-and-benchmarks.md?raw";
import roadmap from "../../docs/roadmap.md?raw";
import versioningMigration from "../../docs/versioning-and-migration.md?raw";
import pluginAuthoring from "../../docs/plugin-authoring.md?raw";
import themingLayout from "../../docs/theming-and-layout.md?raw";
import troubleshooting from "../../docs/troubleshooting.md?raw";

export interface DocPage {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly sourcePath: string;
  readonly markdown: string;
}

export interface DocNavSection {
  readonly title: string;
  readonly slugs: readonly string[];
}

export const DOC_PAGES: readonly DocPage[] = [
  {
    slug: "overview",
    title: "Overview",
    description: "Install BlazePlot, create your first chart, and understand the main tradeoffs.",
    sourcePath: "docs/overview.md",
    markdown: overview,
  },
  {
    slug: "docs-map",
    title: "Docs map",
    description: "Reader paths, page ownership, and where each documentation topic belongs.",
    sourcePath: "docs/README.md",
    markdown: docsMap,
  },
  {
    slug: "examples",
    title: "Examples",
    description: "Copy-paste patterns for chart setup, plugins, data feeds, and exports.",
    sourcePath: "docs/examples.md",
    markdown: examples,
  },
  {
    slug: "live-data",
    title: "Live data",
    description: "Streaming appends, fixed-rate shortcuts, sample updates, and follow-latest behavior.",
    sourcePath: "docs/live-data.md",
    markdown: liveData,
  },
  {
    slug: "performance-recipes",
    title: "Performance",
    description: "Practical guidance for streaming, LOD, dense data, and browser budgets.",
    sourcePath: "docs/performance-recipes.md",
    markdown: performanceRecipes,
  },
  {
    slug: "data-semantics",
    title: "Data",
    description: "How BlazePlot interprets series data, ordering, ring buffers, and sampling.",
    sourcePath: "docs/data-semantics.md",
    markdown: dataSemantics,
  },
  {
    slug: "built-in-plugins",
    title: "Plugins",
    description: "Use optional interaction, tooltip, legend, annotation, selection, crosshair, and navigator plugins.",
    sourcePath: "docs/built-in-plugins.md",
    markdown: builtInPlugins,
  },
  {
    slug: "plugin-authoring",
    title: "Author plugins",
    description: "Build lightweight chart plugins without coupling them to the core renderer.",
    sourcePath: "docs/plugin-authoring.md",
    markdown: pluginAuthoring,
  },
  {
    slug: "theming-and-layout",
    title: "Theme & layout",
    description: "Chart theme tokens, axis placement, gutters, and responsive layout behavior.",
    sourcePath: "docs/theming-and-layout.md",
    markdown: themingLayout,
  },
  {
    slug: "troubleshooting",
    title: "Troubleshooting",
    description: "Fix blank charts, live viewport issues, performance drift, and common React mistakes.",
    sourcePath: "docs/troubleshooting.md",
    markdown: troubleshooting,
  },
  {
    slug: "browser-support",
    title: "Browser",
    description: "Runtime requirements and WebGL2 support expectations.",
    sourcePath: "docs/browser-support.md",
    markdown: browserSupport,
  },
  {
    slug: "versioning-and-migration",
    title: "Migration",
    description: "Semver policy, migration expectations, and public API stability notes.",
    sourcePath: "docs/versioning-and-migration.md",
    markdown: versioningMigration,
  },
  {
    slug: "release-and-benchmarks",
    title: "Release",
    description: "Release flow, benchmark commands, and how to read generated performance tables.",
    sourcePath: "docs/release-and-benchmarks.md",
    markdown: releaseBenchmarks,
  },
  {
    slug: "roadmap",
    title: "Roadmap",
    description: "Current status, near-term priorities, and non-goals for BlazePlot.",
    sourcePath: "docs/roadmap.md",
    markdown: roadmap,
  },
  {
    slug: "documentation-contributions",
    title: "Docs process",
    description: "How to make BlazePlot docs concrete, source-checked, and useful.",
    sourcePath: "docs/documentation-contributions.md",
    markdown: documentationContributions,
  },
  {
    slug: "api-reference",
    title: "API reference",
    description: "Generated package entry point, symbol, bundle size, and public API reference.",
    sourcePath: "docs/api-reference.md",
    markdown: apiReference,
  },
] as const;

export const DOC_NAV_SECTIONS: readonly DocNavSection[] = [
  { title: "Start", slugs: ["overview", "docs-map", "examples"] },
  { title: "Data and performance", slugs: ["live-data", "data-semantics", "performance-recipes"] },
  { title: "UI", slugs: ["built-in-plugins", "theming-and-layout", "plugin-authoring"] },
  { title: "Reference", slugs: ["troubleshooting", "browser-support", "versioning-and-migration", "api-reference"] },
] as const;

export function getDocPage(slug: string | undefined): DocPage {
  const page = DOC_PAGES.find((candidate) => candidate.slug === slug) ?? DOC_PAGES[0];
  if (!page) throw new Error("No documentation pages are configured");
  return page;
}
