#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";

function usage(exitCode = 1) {
  const output = exitCode === 0 ? console.log : console.error;
  output(`Usage: node scripts/bump-version.js <patch|minor|major|x.y.z>

Bumps package.json and creates a changelog stub for the release PR.
This script does not commit, tag, push, publish, or create a GitHub Release.
Merging the release PR to main runs the release workflow.
`);
  process.exit(exitCode);
}

const [increment] = process.argv.slice(2);
if (!increment || increment === "-h" || increment === "--help") usage(increment ? 0 : 1);

const pkgPath = new URL("../package.json", import.meta.url);
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
const current = parseVersion(pkg.version);
const next = nextVersion(current, increment);

pkg.version = next;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

const changelogPath = new URL(`../changelogs/v${next}.md`, import.meta.url);
if (!existsSync(changelogPath)) {
  writeFileSync(changelogPath, `# BlazePlot v${next}\n\n## Changes\n\n- TODO\n`);
}

console.log(`Prepared v${next}.`);
console.log(`Next: edit changelogs/v${next}.md, run bun run docs:readme, then open a PR to main.`);

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
  usage();
}
