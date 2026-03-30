#!/bin/sh
# Regenerates the SVG list in index.html from the assets/ directory.
cd "$(dirname "$0")"
LIST=$(ls assets/*.svg 2>/dev/null | while read f; do printf '  "%s",\n' "$(basename "$f")"; done)
sed -i '' "/^const svgs = \[/,/^\];/{
/^const svgs = \[/!{/^\];/!d;}
/^const svgs = \[/a\\
$LIST
}" index.html
echo "Updated index.html with $(ls assets/*.svg 2>/dev/null | wc -l | tr -d ' ') SVG(s)."
