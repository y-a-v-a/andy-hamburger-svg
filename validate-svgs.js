#!/usr/bin/env node
// Checks that SVGs are well-formed, namespace-correct XML with an <svg> root
// in the SVG namespace, which is what the browser's XML parser requires to
// render them through <object type="image/svg+xml"> in index.html.
//
// Usage:
//   node validate-svgs.js                 validate every SVG in assets/
//   node validate-svgs.js <file>...       validate the given files
//   node validate-svgs.js --new           validate untracked SVGs in assets/
//   node validate-svgs.js --reject ...    move invalid files to rejected/
//   node validate-svgs.js --fix ...       before validating, add a missing SVG
//                                         xmlns and xmlns:xlink to the root
//
// Exits 1 when an invalid file was found and not rejected.

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { SaxesParser } = require("saxes");

const ROOT = __dirname;
const ASSETS = path.join(ROOT, "assets");
const REJECTED = path.join(ROOT, "rejected");
const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

const argv = process.argv.slice(2);
const REJECT = argv.includes("--reject");
const FIX = argv.includes("--fix");
const NEW = argv.includes("--new");
const fileArgs = argv.filter((a) => !a.startsWith("--"));

function untrackedSvgs() {
  const out = execFileSync(
    "git",
    ["ls-files", "-z", "--others", "--exclude-standard", "--", "assets/*.svg"],
    { cwd: ROOT, encoding: "utf8" },
  );
  return out.split("\0").filter(Boolean).map((f) => path.join(ROOT, f));
}

function allSvgs() {
  return fs
    .readdirSync(ASSETS)
    .filter((f) => f.endsWith(".svg"))
    .sort()
    .map((f) => path.join(ASSETS, f));
}

function parse(xml) {
  const errors = [];
  const parser = new SaxesParser({ xmlns: true });
  let root = null;
  parser.on("error", (err) => errors.push(err.message));
  parser.on("opentag", (tag) => {
    if (!root) root = tag;
  });
  try {
    parser.write(xml).close();
  } catch (err) {
    errors.push(err.message);
  }
  return { errors, root };
}

function validate(xml) {
  const { errors, root } = parse(xml);
  if (!root) errors.push("no root element");
  else if (root.local !== "svg" || root.uri !== SVG_NS) {
    errors.push(`root is <${root.name}> in namespace "${root.uri}", expected <svg> in ${SVG_NS}`);
  }
  return errors;
}

// Only touches a root <svg> at the start of the file (after an optional XML
// declaration), and only adds declarations that are missing, never replaces.
function fix(xml) {
  const start = xml.match(/^\s*(<\?xml[^>]*\?>\s*)?<svg(?=[\s>/])/);
  if (!start) return xml;
  const { errors, root } = parse(xml);
  if (!root || root.name !== "svg") return xml;
  const add = [];
  if (!("xmlns" in root.attributes)) add.push(`xmlns="${SVG_NS}"`);
  if (!("xmlns:xlink" in root.attributes) && errors.some((e) => e.includes('unbound namespace prefix: "xlink"'))) {
    add.push(`xmlns:xlink="${XLINK_NS}"`);
  }
  if (!add.length) return xml;
  const at = start[0].length;
  return `${xml.slice(0, at)} ${add.join(" ")}${xml.slice(at)}`;
}

const files = NEW ? untrackedSvgs() : fileArgs.length ? fileArgs.map((f) => path.resolve(f)) : allSvgs();

let invalid = 0;
let fixed = 0;
for (const file of files) {
  let xml = fs.readFileSync(file, "utf8");
  const rel = path.relative(ROOT, file);
  if (FIX) {
    const repaired = fix(xml);
    if (repaired !== xml) {
      fs.writeFileSync(file, repaired);
      xml = repaired;
      fixed++;
      console.log(`fixed    ${rel}`);
    }
  }
  const errors = validate(xml);
  if (!errors.length) {
    console.log(`ok       ${rel}`);
    continue;
  }
  invalid++;
  console.log(`INVALID  ${rel}`);
  for (const e of errors.slice(0, 3)) console.log(`         ${e}`);
  if (errors.length > 3) console.log(`         ... ${errors.length - 3} more`);
  if (REJECT) {
    fs.mkdirSync(REJECTED, { recursive: true });
    fs.renameSync(file, path.join(REJECTED, path.basename(file)));
    console.log(`         moved to rejected/`);
  }
}

console.log(`\n${files.length - invalid}/${files.length} valid${FIX ? `, ${fixed} fixed` : ""}.`);
if (invalid && !REJECT) process.exit(1);
