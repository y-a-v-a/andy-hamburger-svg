#!/usr/bin/env node
// Runs the full flow: generate SVGs (LIMIT models, default 10), validate the
// new ones (invalid files are moved to rejected/), update index.html, and
// commit only the new SVGs, index.html and skip.json. Does not push.

const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = __dirname;
const run = (cmd, args, env = process.env) =>
  execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit", env });
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });

const untrackedSvgs = () =>
  git("ls-files", "-z", "--others", "--exclude-standard", "--", "assets/*.svg")
    .split("\0")
    .filter(Boolean);

const before = new Set(untrackedSvgs());

run("node", ["generate-svgs.js"], { ...process.env, LIMIT: process.env.LIMIT ?? "10" });

const generated = untrackedSvgs().filter((f) => !before.has(f));
if (generated.length) {
  console.log("\nValidating new SVGs:");
  run("node", ["validate-svgs.js", "--fix", "--reject", ...generated]);
}

const valid = untrackedSvgs().filter((f) => !before.has(f));
const paths = [...valid];
if (valid.length) {
  run(path.join(ROOT, "update-svgs.sh"), []);
  paths.push("index.html");
}
if (git("status", "--porcelain", "--", "skip.json")) paths.push("skip.json");

if (!paths.length) {
  console.log("\nNothing to commit.");
  process.exit(0);
}

const message = valid.length ? "adds new svgs" : "updates skip list";
git("add", "--", ...paths);
git("commit", "-m", message, "--", ...paths);
console.log(`\nCommitted ${valid.length} new SVG(s):\n${git("log", "--oneline", "-1")}`);
