// Verifies the documented TypeScript floor (docs/versioning-and-migration.md): packs the built package,
// installs the tarball into a throwaway consumer project per TypeScript version, and typechecks a file
// importing every `package.json#exports` subpath with `skipLibCheck: false` under `bundler`, `node16`, and legacy `node10`
// module resolution. Needs a fresh `bun run build` and network access to install TypeScript.
//
// Usage: bun scripts/typescript-floor-test.ts [--ts 5.0.4,5] [--keep]
//   --ts    comma-separated TypeScript versions or ranges (default: the floor 5.0.4 and the latest 5.x)
//   --keep  keep the temp directory for debugging
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FLOOR = "5.0.4";
const DEFAULT_VERSIONS = [FLOOR, "5"];
const RESOLUTIONS = ["bundler", "node16", "node10"] as const;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const tsFlag = args.indexOf("--ts");
const versions = tsFlag >= 0 && args[tsFlag + 1] ? args[tsFlag + 1]!.split(",").map((v) => v.trim()).filter(Boolean) : DEFAULT_VERSIONS;
const keep = args.includes("--keep");

async function run(cmd: string[], cwd: string): Promise<{ ok: boolean; output: string }> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  return { ok: code === 0, output: `${out}${err}`.trim() };
}

const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { name: string; exports: Record<string, unknown> };
const specifiers = Object.keys(pkg.exports)
  .filter((subpath) => subpath !== "./package.json")
  .map((subpath) => (subpath === "." ? pkg.name : `${pkg.name}/${subpath.slice(2)}`));

const work = await mkdtemp(join(tmpdir(), "blazeplot-ts-floor-"));
let failed = false;
try {
  const packDir = join(work, "pack");
  await mkdir(packDir);
  const pack = await run(["bun", "pm", "pack", "--destination", packDir, "--quiet"], root);
  if (!pack.ok) throw new Error(`bun pm pack failed:\n${pack.output}`);
  const tarball = (await readdir(packDir)).find((f) => f.endsWith(".tgz"));
  if (!tarball) throw new Error("bun pm pack produced no .tgz (did you run `bun run build`?).");
  const tarballPath = join(packDir, tarball);

  const consumerSource = [
    ...specifiers.map((s, i) => `import * as m${i} from ${JSON.stringify(s)};`),
    `export const modules = [${specifiers.map((_, i) => `m${i}`).join(", ")}];`,
    "",
  ].join("\n");

  for (const requested of versions) {
    const dir = join(work, `ts-${requested.replace(/[^\w.]/g, "_")}`);
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "consumer", private: true, type: "module", dependencies: { [pkg.name]: `file:${tarballPath}`, typescript: requested } }, null, 2),
    );
    await writeFile(join(dir, "src", "index.ts"), consumerSource);
    const install = await run(["bun", "install"], dir);
    if (!install.ok) throw new Error(`Installing TypeScript ${requested} and the packed tarball failed:\n${install.output}`);
    const tsc = join(dir, "node_modules", "typescript", "bin", "tsc");
    const actual = (JSON.parse(await readFile(join(dir, "node_modules", "typescript", "package.json"), "utf8")) as { version: string }).version;

    for (const moduleResolution of RESOLUTIONS) {
      const config = {
        compilerOptions: {
          target: "ES2022",
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          module: moduleResolution === "node16" ? "node16" : "ESNext",
          moduleResolution,
          strict: true,
          skipLibCheck: false,
          noEmit: true,
          types: [],
        },
        include: ["src"],
      };
      await writeFile(join(dir, "tsconfig.json"), JSON.stringify(config, null, 2));
      const result = await run(["node", tsc, "-p", "tsconfig.json"], dir);
      const label = `TypeScript ${actual} (${moduleResolution})`;
      if (result.ok) {
        console.log(`ok   ${label}: ${specifiers.length} entry points typecheck with skipLibCheck: false`);
      } else {
        failed = true;
        console.error(`FAIL ${label}\n${result.output}`);
      }
    }
  }
} finally {
  if (keep) console.log(`Kept ${work}`);
  else await rm(work, { recursive: true, force: true });
}

if (failed) process.exit(1);
