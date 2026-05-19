#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";

function usage(exitCode = 1) {
  const output = exitCode === 0 ? console.log : console.error;
  output(`Usage: node scripts/release.js <patch|minor|major> [options]

Options:
  --notes <file>       Include curated release notes from a markdown/text file.
                       Defaults to changelogs/v<newVersion>.md.
                       Use "-" to read notes from stdin.
  --no-commits         Do not append the generated commit list.
  -h, --help           Show this help.

Examples:
  node scripts/release.js minor
  node scripts/release.js minor --notes RELEASE_NOTES.md
`);
  process.exit(exitCode);
}

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) usage(0);

const type = args.shift();
if (!type || !["patch", "minor", "major"].includes(type)) usage();

let notesPath = "";
let includeCommits = true;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--notes") {
    const value = args[++i];
    if (!value) {
      console.error("Missing value for --notes.");
      usage();
    }
    notesPath = value;
  } else if (arg === "--no-commits") {
    includeCommits = false;
  } else {
    console.error(`Unknown option: ${arg}`);
    usage();
  }
}

function readReleaseNotes(path) {
  if (!path) return "";
  const notes = path === "-"
    ? readFileSync(0, "utf-8")
    : readFileSync(path, "utf-8");
  return notes.trim();
}

function collectCommitLog(prevTag) {
  try {
    execSync(`git rev-parse --verify --quiet "${prevTag}"`, { stdio: "pipe" });
    return execSync(
      `git log --oneline --format="%h - %s - %an" "${prevTag}..HEAD"`,
      { encoding: "utf-8" },
    ).trim();
  } catch {
    return "";
  }
}

function buildReleaseMessage(version, notes, commitLog) {
  const sections = [`chore(release): v${version}`];

  if (notes) {
    sections.push(`Release notes:\n\n${notes}`);
  }

  if (commitLog) {
    sections.push(`Commits since previous release:\n\n${commitLog}`);
  }

  return `${sections.join("\n\n")}\n`;
}

function buildGitHubReleaseBody(notes, commitLog) {
  const sections = [];
  if (notes) sections.push(notes);
  if (commitLog) sections.push(`## Commits\n\n${commitLog}`);
  return `${sections.join("\n\n")}\n`;
}

function publishGitHubRelease(tag, body) {
  const title = tag;
  try {
    execFileSync("gh", ["release", "view", tag], { stdio: "pipe" });
    execFileSync("gh", ["release", "edit", tag, "--title", title, "--notes", body], { stdio: "inherit" });
    return;
  } catch (error) {
    if (error?.status !== 1) throw error;
  }

  execFileSync("gh", ["release", "create", tag, "--title", title, "--notes", body], { stdio: "inherit" });
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

if (!notesPath) notesPath = `changelogs/v${newVersion}.md`;
if (notesPath !== "-" && !existsSync(notesPath)) {
  console.error(`Release notes file not found: ${notesPath}`);
  console.error("Create it or pass --notes <file>.");
  process.exit(1);
}

const prevTag = `v${oldVersion}`;
const releaseNotes = readReleaseNotes(notesPath);
const commitLog = includeCommits ? collectCommitLog(prevTag) : "";
const githubReleaseBody = buildGitHubReleaseBody(releaseNotes, commitLog);

pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
execFileSync("bun", ["run", "docs:readme"], { stdio: "inherit" });

execFileSync("git", ["add", "package.json", "README.md"]);
if (notesPath !== "-") execFileSync("git", ["add", notesPath]);

const message = buildReleaseMessage(newVersion, releaseNotes, commitLog);
execSync("git commit -F -", { input: message });

const tag = `v${newVersion}`;
execSync(`git tag ${tag}`);
execSync("git push origin HEAD");
execSync(`git push origin ${tag}`);
publishGitHubRelease(tag, githubReleaseBody);

console.log(`Released ${tag}`);
