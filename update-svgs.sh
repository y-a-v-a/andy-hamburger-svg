#!/bin/sh
# Regenerates the SVG list in index.html from the assets/ directory.
cd "$(dirname "$0")"
node -e '
const fs = require("fs");
const path = "index.html";
const svgs = fs.readdirSync("assets").filter(f => f.endsWith(".svg")).sort();
const block = "const svgs = [\n" + svgs.map(f => `  ${JSON.stringify(f)},`).join("\n") + "\n];";
const html = fs.readFileSync(path, "utf8");
const updated = html.replace(/const svgs = \[[\s\S]*?\];/, block);
if (html === updated) { console.error("marker not found"); process.exit(1); }
fs.writeFileSync(path, updated);
'
echo "Updated index.html with $(ls assets/*.svg 2>/dev/null | wc -l | tr -d ' ') SVG(s)."
