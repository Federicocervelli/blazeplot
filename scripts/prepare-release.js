#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const USAGE = `Usage: bun run release <patch|minor|major|x.y.z> [--dry-run]

Prepares a release on the current branch: bumps package.json, drafts
changelogs/vX.Y.Z.md from the commits since the last stable tag, and regenerates the docs.
It does not commit, tag, push, or publish.

  patch|minor|major  Bump from the current version. Run on a release/vX.Y.Z branch cut from
                     main, then open a PR to main (merging it publishes to npm "latest").
  x.y.z              Explicit version. Must be greater than the current one.

--dry-run prints the planned version and changelog without writing anything or
regenerating docs.
`;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const [increment] = args.filter((arg) => !arg.startsWith("--") || arg === "--help");
if (!increment || increment === "-h" || increment === "--help") {
  (increment ? console.log : console.error)(USAGE);
  process.exit(increment ? 0 : 1);
}

const pkgPath = new URL("../package.json", import.meta.url);
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
const current = parseVersion(pkg.version);
const next = nextVersion(current, increment);
if (compareVersions(parseVersion(next), current) <= 0) fail(`Next version ${next} must be greater than the current ${pkg.version}.`);

const changelogPath = new URL(`../changelogs/v${next}.md`, import.meta.url);
const changelog = `# BlazePlot v${next}\n\n## Changes\n\n${draftChanges()}\n`;

if (dryRun) {
  console.log(`[dry-run] ${pkg.version} -> ${next} (npm dist-tag: latest, PR base: main)`);
  console.log(
    existsSync(changelogPath)
      ? `[dry-run] changelogs/v${next}.md exists; would keep it.`
      : `[dry-run] would write changelogs/v${next}.md:\n\n${changelog}`,
  );
  process.exit(0);
}

pkg.version = next;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
if (!existsSync(changelogPath)) writeFileSync(changelogPath, changelog);

execFileSync(process.platform === "win32" ? "bun.exe" : "bun", ["run", "docs:readme"], { stdio: "inherit" });

console.log(`\nPrepared v${next}. Edit changelogs/v${next}.md, commit, and open a PR to main.`);

function draftChanges() {
  // Notes cover everything since the last stable tag.
  const lastTag = git(["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", "--exclude", "v*-*"]);
  const range = lastTag ? [`${lastTag}..HEAD`] : [];
  const subjects = git(["log", "--no-merges", "--pretty=format:%s", ...range])
    .split("\n")
    .filter((line) => line && !/^Release v\d/.test(line));
  return subjects.length > 0 ? subjects.map((line) => `- ${line}`).join("\n") : "- TODO";
}

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function fail(message) {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(1);
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) throw new Error(`Expected a stable version x.y.z, got ${value}`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function compareVersions(a, b) {
  for (const key of ["major", "minor", "patch"]) if (a[key] !== b[key]) return a[key] - b[key];
  return 0;
}

function nextVersion(v, value) {
  if (value === "major") return `${v.major + 1}.0.0`;
  if (value === "minor") return `${v.major}.${v.minor + 1}.0`;
  if (value === "patch") return `${v.major}.${v.minor}.${v.patch + 1}`;
  if (/^\d+\.\d+\.\d+$/.test(value)) return value;
  return fail(`Unrecognized release argument: ${value}`);
}
