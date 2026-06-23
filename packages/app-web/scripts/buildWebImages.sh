#!/bin/sh
set -e

# Build app-web favicon assets into the build output directory.
#
# Sourced from the shared brand logo in @tearleads/ui and generated straight
# into dist/ (gitignored) so the deploy rsync ships them and the service
# worker can precache them. Run after the dist bundle exists.
#
# The favicon <link> tags are injected into dist/index.html here rather than
# kept in src/index.html: Bun's HTML bundler tries to resolve root-absolute
# asset paths (/favicon.svg etc.) at build time and fails when they do not
# exist yet.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$PACKAGE_DIR/../.." && pwd)"

SVG_SOURCE="$REPO_ROOT/packages/ui/assets/logo.svg"
OUTPUT_DIR="$PACKAGE_DIR/dist"
INDEX_HTML="$OUTPUT_DIR/index.html"

"$REPO_ROOT/scripts/buildFaviconImages.sh" "$SVG_SOURCE" "$OUTPUT_DIR"

if [ ! -f "$INDEX_HTML" ]; then
  echo "Error: $INDEX_HTML not found; run the bundle build first." >&2
  exit 1
fi

FAVICON_INDEX="$INDEX_HTML" bun -e '
const file = process.env.FAVICON_INDEX;
const html = await Bun.file(file).text();
if (html.includes("/favicon.svg")) process.exit(0);
const links =
  "<link rel=\"icon\" href=\"/favicon.ico\" sizes=\"48x48\" />" +
  "<link rel=\"icon\" href=\"/favicon.svg\" type=\"image/svg+xml\" />" +
  "<link rel=\"apple-touch-icon\" href=\"/apple-touch-icon.png\" />";
const out = html.replace("</head>", links + "</head>");
if (out === html) throw new Error("No </head> found in " + file);
await Bun.write(file, out);
'

echo "  Injected favicon links into $INDEX_HTML"
