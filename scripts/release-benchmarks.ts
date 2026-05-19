#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync } from "node:fs";

interface Options {
  scenario: string;
  measureMs: string;
  warmupMs: string;
  width: string;
  height: string;
  top: string;
  setupTimeoutMs: string;
  ifMissing: boolean;
}

const options = parseArgs(process.argv.slice(2));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
const changelogPath = `changelogs/v${pkg.version}.md`;

if (!existsSync(changelogPath)) {
  throw new Error(`Release changelog not found: ${changelogPath}. Run bun run version:patch/minor/major first.`);
}

let changelog = readFileSync(changelogPath, "utf8");
if (options.ifMissing && changelog.includes("Command: `bun run bench:report")) {
  console.log(`${changelogPath} already contains benchmark results; skipping.`);
  process.exit(0);
}

if (!changelog.includes("\n## Benchmarks")) {
  const separator = changelog.endsWith("\n") ? "" : "\n";
  changelog = `${changelog}${separator}\n## Benchmarks\n\n`;
  writeFileSync(changelogPath, changelog);
}

const args = [
  "scripts/benchmark-report.ts",
  "--scenario", options.scenario,
  "--measure-ms", options.measureMs,
  "--warmup-ms", options.warmupMs,
  "--width", options.width,
  "--height", options.height,
  "--top", options.top,
  "--setup-timeout-ms", options.setupTimeoutMs,
  "--out-md", changelogPath,
];

console.log(`Appending release benchmark results to ${changelogPath}...`);
const proc = Bun.spawn(["bun", ...args], { stdout: "inherit", stderr: "inherit" });
const exitCode = await proc.exited;
if (exitCode !== 0) process.exit(exitCode);

function parseArgs(args: readonly string[]): Options {
  const options: Options = {
    scenario: "ci-smoke",
    measureMs: "750",
    warmupMs: "100",
    width: "800",
    height: "450",
    top: "12",
    setupTimeoutMs: "60000",
    ifMissing: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;
    const [flag, inlineValue] = arg.split("=", 2) as [string, string?];
    const readValue = (): string => {
      if (inlineValue !== undefined) return inlineValue;
      const next = args[++i];
      if (!next) throw new Error(`Missing value for ${flag}`);
      return next;
    };

    switch (flag) {
      case "--scenario":
        options.scenario = readValue();
        break;
      case "--measure-ms":
        options.measureMs = readValue();
        break;
      case "--warmup-ms":
        options.warmupMs = readValue();
        break;
      case "--width":
        options.width = readValue();
        break;
      case "--height":
        options.height = readValue();
        break;
      case "--top":
        options.top = readValue();
        break;
      case "--setup-timeout-ms":
        options.setupTimeoutMs = readValue();
        break;
      case "--if-missing":
        options.ifMissing = true;
        break;
      case "--help":
      case "-h":
        printHelpAndExit();
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function printHelpAndExit(): never {
  console.log(`Usage: bun run release:benchmarks [options]\n\nAppends benchmark results to changelogs/v<package.version>.md.\n\nOptions:\n  --scenario <name>          Scenario to benchmark (default: ci-smoke)\n  --measure-ms <ms>          Measurement duration (default: 750)\n  --warmup-ms <ms>           Warmup duration (default: 100)\n  --width <px>               Browser width (default: 800)\n  --height <px>              Browser height (default: 450)\n  --top <n>                  CPU profile rows to capture (default: 12)\n  --setup-timeout-ms <ms>    Setup timeout (default: 60000)\n  --if-missing               Skip when changelog already contains benchmark results\n`);
  process.exit(0);
}
