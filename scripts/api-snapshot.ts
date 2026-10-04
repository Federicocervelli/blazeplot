/**
 * Public API snapshot check.
 *
 * Reads the emitted `dist/**\/*.d.ts` for every `package.json#exports` entry, prints each exported
 * declaration (comments stripped, so only names and signatures count), and compares the result with
 * the committed `api/public-api.md`.
 *
 *   bun run test:api              check dist against the snapshot (run `bun run build` first)
 *   bun run test:api -- --update  rewrite the snapshot after an intentional API change
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "@typescript/typescript6";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotPath = resolve(root, "api/public-api.md");
const update = process.argv.includes("--update");

type ExportEntry = { specifier: string; dts: string };

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  name: string;
  exports: Record<string, string | { types?: string }>;
};

const entries: ExportEntry[] = Object.entries(pkg.exports)
  .filter(([, value]) => typeof value === "object" && value.types)
  .map(([subpath, value]) => ({
    specifier: subpath === "." ? pkg.name : `${pkg.name}/${subpath.slice(2)}`,
    dts: resolve(root, (value as { types: string }).types),
  }));

for (const entry of entries) {
  if (!existsSync(entry.dts)) {
    console.error(`Missing ${entry.dts}. Run \`bun run build\` first.`);
    process.exit(1);
  }
}

const program = ts.createProgram(entries.map((entry) => entry.dts), {
  noEmit: true,
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  types: [],
});
const checker = program.getTypeChecker();
const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });
const distRoot = resolve(root, "dist").replaceAll("\\", "/");

function kindOf(symbol: ts.Symbol): string {
  const f = symbol.flags;
  if (f & ts.SymbolFlags.Class) return "class";
  if (f & ts.SymbolFlags.Interface) return "interface";
  if (f & ts.SymbolFlags.TypeAlias) return "type";
  if (f & ts.SymbolFlags.Enum) return "enum";
  if (f & ts.SymbolFlags.Function) return "function";
  if (f & ts.SymbolFlags.Variable) return "const";
  if (f & ts.SymbolFlags.Namespace) return "namespace";
  return "other";
}

function printDeclaration(decl: ts.Declaration): string {
  const sf = decl.getSourceFile();
  let node: ts.Node = decl;
  if (ts.isClassDeclaration(decl)) {
    // Private members are not API; keep private constructors because they change how a class can be used.
    const members = decl.members.filter((member) => ts.isConstructorDeclaration(member) || !(ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Private));
    node = ts.factory.updateClassDeclaration(decl, ts.getModifiers(decl), decl.name, decl.typeParameters, decl.heritageClauses, members);
  }
  let text = printer.printNode(ts.EmitHint.Unspecified, node, sf);
  text = text.replace(/^export\s+/, "").replace(/^declare\s+/, "");
  return text.replaceAll("\r\n", "\n").trim();
}

const exportedAnywhere = new Set<string>();
for (const entry of entries) {
  const moduleSymbol = checker.getSymbolAtLocation(program.getSourceFile(entry.dts)!);
  if (moduleSymbol) for (const symbol of checker.getExportsOfModule(moduleSymbol)) exportedAnywhere.add(symbol.name);
}

function section(entry: ExportEntry): string {
  const sf = program.getSourceFile(entry.dts);
  if (!sf) throw new Error(`Cannot load ${entry.dts}`);
  const moduleSymbol = checker.getSymbolAtLocation(sf);
  if (!moduleSymbol) throw new Error(`${entry.dts} is not a module`);

  const exported = checker.getExportsOfModule(moduleSymbol).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const leaked = new Set<string>();
  const blocks: string[] = [];

  const collectRefs = (node: ts.Node): void => {
    if (ts.isTypeReferenceNode(node) || ts.isExpressionWithTypeArguments(node)) {
      const nameNode = ts.isTypeReferenceNode(node) ? node.typeName : node.expression;
      let ref = checker.getSymbolAtLocation(nameNode);
      if (ref && ref.flags & ts.SymbolFlags.Alias) ref = checker.getAliasedSymbol(ref);
      const decl = ref?.declarations?.[0];
      if (ref && decl && !(ref.flags & ts.SymbolFlags.TypeParameter) && decl.getSourceFile().fileName.replaceAll("\\", "/").startsWith(distRoot) && !exportedAnywhere.has(ref.name)) {
        leaked.add(ref.name);
      }
    }
    ts.forEachChild(node, collectRefs);
  };

  for (const symbol of exported) {
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const decls = target.declarations ?? [];
    const label = `${kindOf(target)} ${symbol.name}`;
    const body = decls.map((decl) => {
      collectRefs(decl);
      return printDeclaration(decl);
    }).join("\n");
    blocks.push(`#### ${label}\n\n\`\`\`ts\n${body}\n\`\`\``);
  }

  const leakedList = [...leaked].sort();
  const leakedBlock = leakedList.length
    ? `\nReferenced by this entry's signatures but not exported from any entry point (${leakedList.length}): ${leakedList.map((name) => `\`${name}\``).join(", ")}\n`
    : "";
  return `### \`${entry.specifier}\`\n\n${exported.length} exports.\n${leakedBlock}\n${blocks.join("\n\n")}`;
}

const header = `# Public API snapshot

<!-- Generated by scripts/api-snapshot.ts from dist/**/*.d.ts. Do not edit by hand. -->
<!-- Update with: bun run build && bun run test:api -- --update -->

Exported names and signatures (comments stripped) for every \`package.json#exports\` entry.
A change here is a public API change: review it against \`docs/versioning-and-migration.md\`.
`;

const output = `${header}\n${entries.map(section).join("\n\n")}\n`;

if (update) {
  mkdirSync(dirname(snapshotPath), { recursive: true });
  writeFileSync(snapshotPath, output);
  console.log(`Wrote ${snapshotPath}`);
  process.exit(0);
}

if (!existsSync(snapshotPath)) {
  console.error("api/public-api.md is missing. Run `bun run build && bun run test:api -- --update`.");
  process.exit(1);
}

const committed = readFileSync(snapshotPath, "utf8").replaceAll("\r\n", "\n");
if (committed === output) {
  console.log(`Public API snapshot matches (${entries.length} entry points).`);
  process.exit(0);
}

const aSet = new Set(committed.split("\n"));
const bSet = new Set(output.split("\n"));
const removed = [...aSet].filter((line) => !bSet.has(line) && line.trim());
const added = [...bSet].filter((line) => !aSet.has(line) && line.trim());
console.error("Public API snapshot is out of date.\n");
for (const line of removed.slice(0, 40)) console.error(`- ${line}`);
for (const line of added.slice(0, 40)) console.error(`+ ${line}`);
if (removed.length > 40 || added.length > 40) console.error("... (truncated)");
console.error("\nIf this change is intentional, run `bun run build && bun run test:api -- --update` and commit api/public-api.md.");
process.exit(1);
