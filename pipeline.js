#!/usr/bin/env node
// Runs the full flow on main: fast-forward to origin/main, generate SVGs
// (LIMIT models, default 10), validate the new ones (invalid files are moved
// to rejected/ and logged in rejected/rejected.log), update index.html, then
// commit the new SVGs, index.html and skip.json and push to origin/main.

const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = __dirname;
const BRANCH = "main";
const run = (cmd, args, env = process.env) =>
  execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit", env });
const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
const fail = (message) => {
  console.error(`\n${message}`);
  process.exit(1);
};

const untrackedSvgs = () =>
  git("ls-files", "-z", "--others", "--exclude-standard", "--", "assets/*.svg")
    .split("\0")
    .filter(Boolean);

const branch = git("rev-parse", "--abbrev-ref", "HEAD").trim();
if (branch !== BRANCH) fail(`On branch "${branch}". Switch to ${BRANCH} first.`);

const dirty = git("status", "--porcelain", "--", "assets", "index.html", "skip.json").trimEnd();
if (dirty) {
  fail(`Uncommitted changes in assets/, index.html or skip.json would end up in index.html or the commit. Commit or discard them first:\n${dirty}`);
}

console.log(`Updating ${BRANCH} from origin/${BRANCH}...`);
run("git", ["fetch", "origin", BRANCH]);
try {
  run("git", ["merge", "--ff-only", `origin/${BRANCH}`]);
} catch {
  fail(`Local ${BRANCH} has diverged from origin/${BRANCH}. Resolve that first.`);
}

run("node", ["generate-svgs.js"], { ...process.env, LIMIT: process.env.LIMIT ?? "10" });

const generated = untrackedSvgs();
if (generated.length) {
  console.log("\nValidating new SVGs:");
  run("node", ["validate-svgs.js", "--fix", "--reject", ...generated]);
}

const valid = untrackedSvgs();
const rejected = generated.filter((f) => !valid.includes(f));
const paths = [...valid];
if (valid.length) {
  run(path.join(ROOT, "update-svgs.sh"), []);
  paths.push("index.html");
}
if (git("status", "--porcelain", "--", "skip.json")) paths.push("skip.json");

if (rejected.length) {
  console.log(`\nRejected ${rejected.length} SVG(s), see rejected/rejected.log:\n  ${rejected.join("\n  ")}`);
}

if (!paths.length) {
  console.log("\nNothing to commit.");
  process.exit(0);
}

const message = valid.length ? "adds new svgs" : "updates skip list";
git("add", "--", ...paths);
git("commit", "-m", message, "--", ...paths);
console.log(`\nCommitted ${valid.length} new SVG(s):\n${git("log", "--oneline", "-1")}`);

try {
  run("git", ["push", "origin", BRANCH]);
} catch {
  fail(`Push failed. The commit is saved locally; run "git push origin ${BRANCH}" once the problem is fixed.`);
}
