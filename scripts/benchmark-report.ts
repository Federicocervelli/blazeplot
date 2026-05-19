#!/usr/bin/env bun
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

interface Options {
  scenarios: string[];
  outMd: string;
  measureMs?: string;
  warmupMs?: string;
  width?: string;
  height?: string;
  top?: string;
  setupTimeoutMs?: string;
  chrome?: string;
}

interface NumericSummary {
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
}

interface BenchmarkReport {
  generatedAt: string;
  browser: string;
  sceneUrl: string;
  benchmark: {
    scenario: string;
    renderer: string;
    durationMs: number;
    liveSamplesAppended: number;
    totalLineSamples: number;
    viewportSamples: number;
    canvas: { width: number; height: number };
    raf: { frames: number; fps: number; frameMs: NumericSummary };
    chart: {
      frameMs: NumericSummary;
      pointsRendered: NumericSummary;
      drawCalls: NumericSummary;
      batchedDrawCalls?: NumericSummary;
      uploadBytes: NumericSummary;
    };
  };
  profile: {
    bottomUp: Array<{
      functionName: string;
      url: string;
      line: number;
      selfMs: number;
      totalMs: number;
    }>;
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const reports: BenchmarkReport[] = [];

  for (const scenario of options.scenarios) {
    reports.push(await runScenario(scenario, options));
  }

  await appendMarkdown(options.outMd, reports, process.argv.slice(2));
  console.log(`Benchmark report appended to ${options.outMd}`);
}

function parseArgs(args: readonly string[]): Options {
  const options: Options = {
    scenarios: ["mixed-1m-live"],
    outMd: "BENCHMARK_RESULTS.md",
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
        options.scenarios = readValue().split(",").map((value) => value.trim()).filter(Boolean);
        break;
      case "--out-md":
        options.outMd = readValue();
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
      case "--chrome":
        options.chrome = readValue();
        break;
      case "--help":
      case "-h":
        printHelpAndExit();
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.scenarios.length === 0) throw new Error("At least one --scenario is required.");
  return options;
}

function printHelpAndExit(): never {
  console.log(`Usage: bun run bench:report [options]\n\nOptions:\n  --scenario <name[,name]>   Scenario(s) to run (default: mixed-1m-live)\n  --out-md <path>            Markdown file to append (default: BENCHMARK_RESULTS.md)\n  --measure-ms <ms>          Forwarded to bench harness\n  --warmup-ms <ms>           Forwarded to bench harness\n  --width <px>               Browser viewport width\n  --height <px>              Browser viewport height\n  --top <n>                  CPU profile rows to capture\n  --setup-timeout-ms <ms>    Setup timeout\n  --chrome <path>            Browser executable\n`);
  process.exit(0);
}

async function runScenario(scenario: string, options: Options): Promise<BenchmarkReport> {
  const tempPath = resolve(`.benchmark-${scenario.replace(/[^a-z0-9_-]/gi, "-")}-${Date.now()}.json`);
  const args = ["scripts/benchmark.ts", "--scenario", scenario, "--out", tempPath];
  appendOption(args, "--measure-ms", options.measureMs);
  appendOption(args, "--warmup-ms", options.warmupMs);
  appendOption(args, "--width", options.width);
  appendOption(args, "--height", options.height);
  appendOption(args, "--top", options.top);
  appendOption(args, "--setup-timeout-ms", options.setupTimeoutMs);
  appendOption(args, "--chrome", options.chrome);

  console.log(`Running benchmark scenario '${scenario}'...`);
  const proc = Bun.spawn(["bun", ...args], { stdout: "inherit", stderr: "inherit" });
  const exitCode = await proc.exited;
  if (exitCode !== 0) throw new Error(`Benchmark scenario '${scenario}' failed with exit code ${exitCode}.`);

  const report = JSON.parse(await readFile(tempPath, "utf8")) as BenchmarkReport;
  await rm(tempPath, { force: true });
  return report;
}

function appendOption(args: string[], flag: string, value: string | undefined): void {
  if (value !== undefined) args.push(flag, value);
}

async function appendMarkdown(path: string, reports: readonly BenchmarkReport[], cliArgs: readonly string[]): Promise<void> {
  const resolved = resolve(path);
  await mkdir(dirname(resolved), { recursive: true });
  const exists = existsSync(resolved);
  const previous = exists ? await readFile(resolved, "utf8") : "";
  const entry = renderMarkdownEntry(reports, cliArgs);
  const header = exists && previous.trim().length > 0
    ? ""
    : "# BlazePlot benchmark results\n\nThis file is appended by `bun run bench:report` so benchmark runs remain easy to compare over time.\n\n";
  await writeFile(resolved, `${previous}${previous.endsWith("\n") || previous.length === 0 ? "" : "\n"}${header}${entry}`);
}

function renderMarkdownEntry(reports: readonly BenchmarkReport[], cliArgs: readonly string[]): string {
  const generatedAt = new Date().toISOString();
  const command = ["bun run bench:report", ...cliArgs].join(" ");
  const lines: string[] = [
    `## ${generatedAt}`,
    "",
    `Command: \`${command}\``,
    "",
    "| Scenario | Browser | Canvas | Renderer | RAF FPS | RAF p95 ms | Chart p50 ms | Chart p95 ms | Points | Draws | Batched | Upload KB |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];

  for (const report of reports) {
    const b = report.benchmark;
    lines.push([
      b.scenario,
      report.browser,
      `${b.canvas.width}x${b.canvas.height}`,
      b.renderer,
      fixed(b.raf.fps, 1),
      fixed(b.raf.frameMs.p95, 2),
      fixed(b.chart.frameMs.p50, 2),
      fixed(b.chart.frameMs.p95, 2),
      integer(b.chart.pointsRendered.p50),
      fixed(b.chart.drawCalls.p50, 0),
      fixed((b.chart.batchedDrawCalls?.p50 ?? 0), 0),
      fixed(b.chart.uploadBytes.p50 / 1024, 1),
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }

  for (const report of reports) {
    lines.push("", `### CPU hot spots: ${report.benchmark.scenario}`, "", "| Function | Self ms | Total ms | Location |", "|---|---:|---:|---|");
    for (const frame of report.profile.bottomUp.slice(0, 8)) {
      lines.push(`| ${escapeMd(frame.functionName || "(anonymous)")} | ${fixed(frame.selfMs, 1)} | ${fixed(frame.totalMs, 1)} | ${escapeMd(location(frame.url, frame.line))} |`);
    }
  }

  lines.push("", "");
  return lines.join("\n");
}

function fixed(value: number, digits: number): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "0";
}

function integer(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function location(url: string, line: number): string {
  const clean = url.replace(/^.*\/(@fs\/)?/, "");
  return line > 0 ? `${clean}:${line}` : clean || "runtime";
}

function escapeMd(value: string): string {
  return value.replaceAll("|", "\\|");
}

await main();
