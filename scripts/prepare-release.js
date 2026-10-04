#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const USAGE = `Usage: bun run release <patch|minor|major|rc|x.y.z|x.y.z-rc.N> [--dry-run]

Prepares a release on the current branch: bumps package.json, drafts
changelogs/vX.Y.Z[-rc.N].md from the commits since the last tag, and regenerates the docs.
It does not commit, tag, push, or publish.

  patch|minor|major  Stable bump from a stable version. Run on a release/vX.Y.Z branch
                     cut from main, then open a PR to main (publishes to npm "latest").
  rc                 Next release candidate (x.y.z-rc.N -> x.y.z-rc.N+1). Run on a branch
                     cut from v1, then open a PR to v1 (publishes to npm "rc").
  x.y.z[-rc.N]       Explicit version, for example 1.0.0-rc.1 to start a candidate series
                     or 1.0.0 for the final release. Must be greater than the current one.

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
const nextParsed = parseVersion(next);
if (compareVersions(nextParsed, current) <= 0) fail(`Next version ${next} must be greater than the current ${pkg.version}.`);
const isRc = nextParsed.rc !== null;
const base = isRc ? "v1" : "main";

const changelogPath = new URL(`../changelogs/v${next}.md`, import.meta.url);
const changelog = `# BlazePlot v${next}\n\n## Changes\n\n${draftChanges(isRc)}\n`;

if (dryRun) {
  console.log(`[dry-run] ${pkg.version} -> ${next} (npm dist-tag: ${isRc ? "rc" : "latest"}, PR base: ${base})`);
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

console.log(`\nPrepared v${next}. Edit changelogs/v${next}.md, commit, and open a PR to ${base}.`);

function draftChanges(prerelease) {
  // Stable notes cover everything since the last stable tag; rc notes since the last tag of any kind.
  const describe = ["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", ...(prerelease ? [] : ["--exclude", "v*-*"])];
  const lastTag = git(describe);
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
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/.exec(value);
  if (!match) throw new Error(`Expected version x.y.z or x.y.z-rc.N, got ${value}`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), rc: match[4] === undefined ? null : Number(match[4]) };
}

function compareVersions(a, b) {
  for (const key of ["major", "minor", "patch"]) if (a[key] !== b[key]) return a[key] - b[key];
  if (a.rc === b.rc) return 0;
  if (a.rc === null) return 1; // a stable release is greater than its candidates
  if (b.rc === null) return -1;
  return a.rc - b.rc;
}

function nextVersion(v, value) {
  const core = `${v.major}.${v.minor}.${v.patch}`;
  if (value === "rc") {
    if (v.rc === null) return fail(`Current version ${core} is stable; start a candidate series with an explicit version such as 1.0.0-rc.1.`);
    return `${core}-rc.${v.rc + 1}`;
  }
  if (value === "major" || value === "minor" || value === "patch") {
    if (v.rc !== null) {
      return fail(`Current version ${core}-rc.${v.rc} is a release candidate; use "rc" for the next candidate or an explicit version such as ${core} to finalize.`);
    }
    if (value === "major") return `${v.major + 1}.0.0`;
    if (value === "minor") return `${v.major}.${v.minor + 1}.0`;
    return `${v.major}.${v.minor}.${v.patch + 1}`;
  }
  if (/^\d+\.\d+\.\d+(-rc\.\d+)?$/.test(value)) return value;
  return fail(`Unrecognized release argument: ${value}`);
}
