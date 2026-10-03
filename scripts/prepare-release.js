#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const USAGE = `Usage: bun run release <patch|minor|major|x.y.z>

Prepares a release on the current branch: bumps package.json, drafts
changelogs/vX.Y.Z.md from the commits since the last tag, and regenerates the docs.
It does not commit, tag, push, or publish. Run it on a release/vX.Y.Z branch cut
from main, then open a PR to main; merging it runs the release workflow.
`;

const [increment] = process.argv.slice(2);
if (!increment || increment === "-h" || increment === "--help") {
  (increment ? console.log : console.error)(USAGE);
  process.exit(increment ? 0 : 1);
}

const pkgPath = new URL("../package.json", import.meta.url);
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
const next = nextVersion(parseVersion(pkg.version), increment);

pkg.version = next;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

const changelogPath = new URL(`../changelogs/v${next}.md`, import.meta.url);
if (!existsSync(changelogPath)) {
  writeFileSync(changelogPath, `# BlazePlot v${next}\n\n## Changes\n\n${draftChanges()}\n`);
}

execFileSync(process.platform === "win32" ? "bun.exe" : "bun", ["run", "docs:readme"], { stdio: "inherit" });

console.log(`\nPrepared v${next}. Edit changelogs/v${next}.md, commit, and open a PR to main.`);

function draftChanges() {
  const lastTag = git(["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*"]);
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

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  if (!match) throw new Error(`Expected package.json version to be x.y.z, got ${value}`);
  return match.slice(1).map(Number);
}

function nextVersion([major, minor, patch], value) {
  if (value === "major") return `${major + 1}.0.0`;
  if (value === "minor") return `${major}.${minor + 1}.0`;
  if (value === "patch") return `${major}.${minor}.${patch + 1}`;
  if (/^\d+\.\d+\.\d+$/.test(value)) return value;
  console.error(USAGE);
  process.exit(1);
}
