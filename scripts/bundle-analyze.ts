import { gzipSync } from "node:zlib";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

const unmappedSourceLabel = "(generated/unmapped)";

interface RawSourceMap {
  readonly version?: number;
  readonly file?: string;
  readonly sources?: readonly string[];
  readonly mappings?: string;
}

interface SourceContribution {
  readonly source: string;
  readonly bytes: number;
}

interface ChunkAnalysis {
  readonly path: string;
  readonly rawBytes: number;
  readonly gzipBytes: number;
  readonly mapPath?: string;
  readonly sourceBytes: number;
  readonly sources: readonly SourceContribution[];
}

interface Options {
  readonly distDir: string;
  readonly top: number;
}

const base64Values = new Map<string, number>(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
    .split("")
    .map((char, index) => [char, index]),
);

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.distDir)) {
    throw new Error(`Missing ${options.distDir}. Run \`bun run build\` before analyzing bundles.`);
  }

  const chunks = await analyzeDist(options.distDir);
  if (chunks.length === 0) {
    throw new Error(`No JavaScript chunks found in ${options.distDir}. Run \`bun run build\` before analyzing bundles.`);
  }

  console.log(renderAnalysis(chunks, options));
}

async function analyzeDist(distDir: string): Promise<ChunkAnalysis[]> {
  const files = await listFiles(distDir);
  const jsChunks = files
    .filter((file) => extname(file) === ".js")
    .sort((left, right) => left.localeCompare(right));

  const chunks: ChunkAnalysis[] = [];
  for (const chunkPath of jsChunks) {
    const code = await readFile(chunkPath, "utf8");
    const mapPath = `${chunkPath}.map`;
    const contributions = existsSync(mapPath)
      ? attributeGeneratedBytes(code, await readSourceMap(mapPath), mapPath)
      : new Map<string, number>();

    const sources = [...contributions.entries()]
      .map(([source, bytes]) => ({ source, bytes }))
      .filter((entry) => entry.bytes > 0)
      .sort(compareContributions);

    chunks.push({
      path: toPosix(relative(process.cwd(), chunkPath)),
      rawBytes: Buffer.byteLength(code),
      gzipBytes: gzipSync(code, { level: 9 }).byteLength,
      mapPath: existsSync(mapPath) ? toPosix(relative(process.cwd(), mapPath)) : undefined,
      sourceBytes: sum(sources.map((entry) => entry.bytes)),
      sources,
    });
  }

  return chunks.sort((left, right) => right.rawBytes - left.rawBytes || left.path.localeCompare(right.path));
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

async function readSourceMap(mapPath: string): Promise<RawSourceMap> {
  const raw = JSON.parse(await readFile(mapPath, "utf8")) as unknown;
  if (!isRawSourceMap(raw)) throw new Error(`Invalid source map: ${mapPath}`);
  return raw;
}

function isRawSourceMap(value: unknown): value is RawSourceMap {
  if (typeof value !== "object" || value === null) return false;
  const map = value as Record<string, unknown>;
  return Array.isArray(map.sources) && typeof map.mappings === "string";
}

function attributeGeneratedBytes(code: string, sourceMap: RawSourceMap, mapPath: string): Map<string, number> {
  const contributions = new Map<string, number>();
  const sources = sourceMap.sources ?? [];
  const codeLines = code.split("\n");
  const mappingLines = (sourceMap.mappings ?? "").split(";");
  let previousSourceIndex = 0;

  for (let lineIndex = 0; lineIndex < codeLines.length; lineIndex += 1) {
    const line = codeLines[lineIndex] ?? "";
    const mappingLine = mappingLines[lineIndex] ?? "";
    let generatedColumn = 0;
    const spans: { column: number; source: string }[] = [];

    for (const encodedSegment of mappingLine.split(",")) {
      if (encodedSegment.length === 0) continue;
      const segment = decodeVlqSegment(encodedSegment);
      const generatedColumnDelta = segment[0];
      if (generatedColumnDelta === undefined) continue;
      generatedColumn += generatedColumnDelta;

      let source = unmappedSourceLabel;
      if (segment.length >= 4) {
        previousSourceIndex += segment[1] ?? 0;
        const mappedSource = sources[previousSourceIndex];
        source = mappedSource === undefined ? unmappedSourceLabel : normalizeSource(mappedSource, mapPath);
      }

      spans.push({ column: clampColumn(generatedColumn, line), source });
    }

    if (spans.length === 0) {
      addBytes(contributions, unmappedSourceLabel, Buffer.byteLength(line));
    } else {
      const firstSpan = spans[0];
      if (firstSpan !== undefined && firstSpan.column > 0) {
        addBytes(contributions, unmappedSourceLabel, byteLengthForColumns(line, 0, firstSpan.column));
      }

      for (let index = 0; index < spans.length; index += 1) {
        const span = spans[index];
        if (span === undefined) continue;
        const nextSpan = spans[index + 1];
        const startColumn = span.column;
        const endColumn = nextSpan === undefined ? line.length : nextSpan.column;
        if (endColumn > startColumn) {
          addBytes(contributions, span.source, byteLengthForColumns(line, startColumn, endColumn));
        }
      }
    }

    if (lineIndex < codeLines.length - 1) addBytes(contributions, unmappedSourceLabel, 1);
  }

  return contributions;
}

function decodeVlqSegment(segment: string): number[] {
  const values: number[] = [];
  let value = 0;
  let shift = 0;

  for (const char of segment) {
    const digit = base64Values.get(char);
    if (digit === undefined) throw new Error(`Invalid source-map VLQ digit: ${char}`);
    const continuation = (digit & 32) !== 0;
    value += (digit & 31) << shift;

    if (continuation) {
      shift += 5;
      continue;
    }

    const negative = (value & 1) === 1;
    const decoded = value >> 1;
    values.push(negative ? -decoded : decoded);
    value = 0;
    shift = 0;
  }

  return values;
}

function normalizeSource(source: string, mapPath: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(source) || source.startsWith("\0")) return source;
  const absolute = isAbsolute(source) ? source : resolve(dirname(mapPath), source);
  const projectRelative = relative(process.cwd(), absolute);
  return toPosix(projectRelative.startsWith("..") ? absolute : projectRelative);
}

function renderAnalysis(chunks: readonly ChunkAnalysis[], options: Options): string {
  const totals = {
    rawBytes: sum(chunks.map((chunk) => chunk.rawBytes)),
    gzipBytes: sum(chunks.map((chunk) => chunk.gzipBytes)),
    sourceBytes: sum(chunks.map((chunk) => chunk.sourceBytes)),
  };
  const aggregateSources = aggregateContributions(chunks);
  const lines = [
    `Bundle analysis for ${options.distDir}`,
    `Generated JS total: ${formatBytes(totals.rawBytes)} raw, ${formatBytes(totals.gzipBytes)} gzip`,
    "",
    "Chunks:",
    renderTable(
      ["Chunk", "Raw", "Gzip", "Attributed", "Sources"],
      chunks.map((chunk) => [
        chunk.path,
        formatBytes(chunk.rawBytes),
        formatBytes(chunk.gzipBytes),
        chunk.mapPath === undefined ? "no map" : formatBytes(chunk.sourceBytes),
        chunk.mapPath === undefined ? "-" : String(chunk.sources.filter((entry) => entry.source !== unmappedSourceLabel).length),
      ]),
      new Set([1, 2, 3, 4]),
    ),
    "",
    `Top source contributors across mapped chunks (top ${options.top}):`,
    ...renderContributionRows(aggregateSources, totals.sourceBytes, options.top, "  "),
  ];

  for (const chunk of chunks) {
    if (chunk.mapPath === undefined) continue;
    lines.push(
      "",
      `${chunk.path} (${formatBytes(chunk.rawBytes)} raw, ${formatBytes(chunk.gzipBytes)} gzip):`,
      ...renderContributionRows(chunk.sources, chunk.sourceBytes, options.top, "  "),
    );
  }

  return lines.join("\n");
}

function renderContributionRows(
  contributions: readonly SourceContribution[],
  totalBytes: number,
  limit: number,
  prefix: string,
): string[] {
  if (contributions.length === 0 || totalBytes === 0) return [`${prefix}(no source-map attribution available)`];

  const visible = contributions.slice(0, limit);
  const hiddenBytes = sum(contributions.slice(limit).map((entry) => entry.bytes));
  const rows = visible.map((entry) =>
    `${prefix}${formatBytes(entry.bytes).padStart(9)}  ${formatPercent(entry.bytes, totalBytes).padStart(6)}  ${entry.source}`,
  );
  if (hiddenBytes > 0) {
    rows.push(`${prefix}${formatBytes(hiddenBytes).padStart(9)}  ${formatPercent(hiddenBytes, totalBytes).padStart(6)}  (remaining ${contributions.length - limit} sources)`);
  }
  return rows;
}

function aggregateContributions(chunks: readonly ChunkAnalysis[]): SourceContribution[] {
  const aggregate = new Map<string, number>();
  for (const chunk of chunks) {
    for (const entry of chunk.sources) addBytes(aggregate, entry.source, entry.bytes);
  }
  return [...aggregate.entries()]
    .map(([source, bytes]) => ({ source, bytes }))
    .sort(compareContributions);
}

function compareContributions(left: SourceContribution, right: SourceContribution): number {
  return right.bytes - left.bytes || left.source.localeCompare(right.source);
}

function renderTable(headers: readonly string[], rows: readonly (readonly string[])[], rightAlignedColumns: ReadonlySet<number>): string {
  const widths = headers.map((header, columnIndex) =>
    Math.max(header.length, ...rows.map((row) => row[columnIndex]?.length ?? 0)),
  );
  const renderRow = (row: readonly string[]) => row
    .map((cell, columnIndex) => {
      const width = widths[columnIndex] ?? 0;
      return rightAlignedColumns.has(columnIndex) ? cell.padStart(width) : cell.padEnd(width);
    })
    .join("  ");

  return [
    renderRow(headers),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...rows.map((row) => renderRow(row)),
  ].join("\n");
}

function parseArgs(args: readonly string[]): Options {
  let distDir = "dist";
  let top = 10;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--dist": {
        const value = args[index + 1];
        if (value === undefined) throw new Error("Missing value for --dist");
        distDir = value;
        index += 1;
        break;
      }
      case "--top": {
        const value = args[index + 1];
        if (value === undefined) throw new Error("Missing value for --top");
        top = Number(value);
        if (!Number.isInteger(top) || top < 1) throw new Error(`Invalid --top value: ${value}`);
        index += 1;
        break;
      }
      case "--help":
      case "-h":
        printHelpAndExit();
        break;
      default:
        throw new Error(`Unknown argument: ${arg ?? ""}`);
    }
  }

  return { distDir, top };
}

function printHelpAndExit(): never {
  console.log(`Usage: bun scripts/bundle-analyze.ts [--dist dist] [--top 10]\n\nReads built JavaScript chunks and source maps, then reports raw/gzip chunk sizes and generated-byte attribution by original source.\n\nOptions:\n  --dist <dir>  Dist directory to analyze (default: dist)\n  --top <n>    Sources to show per summary/chunk (default: 10)\n`);
  process.exit(0);
}

function addBytes(contributions: Map<string, number>, source: string, bytes: number): void {
  if (bytes <= 0) return;
  contributions.set(source, (contributions.get(source) ?? 0) + bytes);
}

function byteLengthForColumns(line: string, startColumn: number, endColumn: number): number {
  return Buffer.byteLength(line.slice(startColumn, endColumn));
}

function clampColumn(column: number, line: string): number {
  if (column < 0) return 0;
  if (column > line.length) return line.length;
  return column;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function formatPercent(bytes: number, totalBytes: number): string {
  if (totalBytes === 0) return "0.0%";
  return `${((bytes / totalBytes) * 100).toFixed(1)}%`;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

await main();
