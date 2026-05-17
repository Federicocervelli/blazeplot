#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const type = process.argv[2];
if (!["patch", "minor", "major"].includes(type)) {
  console.error("Usage: node scripts/release.js <patch|minor|major>");
  process.exit(1);
}

const pkgPath = new URL("../package.json", import.meta.url);
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
const oldVersion = pkg.version;
const [major, minor, patch] = oldVersion.split(".").map(Number);

let newVersion;
if (type === "major") {
  newVersion = `${major + 1}.0.0`;
} else if (type === "minor") {
  newVersion = `${major}.${minor + 1}.0`;
} else {
  newVersion = `${major}.${minor}.${patch + 1}`;
}

// Collect changelog: commits between the previous version tag and HEAD
const prevTag = `v${oldVersion}`;
let changelog = "";
try {
  // Check if the previous tag exists
  execSync(`git rev-parse --verify --quiet "${prevTag}"`, { stdio: "pipe" });
  const log = execSync(
    `git log --oneline --format="%h - %s - %an" "${prevTag}..HEAD"`,
    { encoding: "utf-8" },
  ).trim();
  if (log) {
    changelog = `\n\n${log}`;
  }
} catch {
  // No previous tag — no changelog
}

pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

execSync(`git add package.json`);
execSync(`git commit -m "chore(release): v${newVersion}" -m "${changelog}"`);
execSync(`git tag v${newVersion}`);
execSync(`git push origin HEAD`);
execSync(`git push origin v${newVersion}`);

console.log(`Released v${newVersion}`);
