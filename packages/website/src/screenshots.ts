import { readFile } from "node:fs/promises";
import {
  parseScreenshotManifest,
  type ScreenshotManifest,
} from "@a2f0/agent-tool/screenshots/manifest";

// Server-only (build time). `agent-tool screenshots build website` (the
// `screenshots` package script) stages the manifest on predev/prebuild, before
// Astro runs; a build without captures gets an empty manifest, so callers must
// render correctly with no entries. Memoized so a build that renders many
// figures and routes reads the file once. Callers pass Astro's publicDir: the
// astro:config/server virtual module is imported only from .astro files,
// which the architecture check does not resolve.
let manifest: Promise<ScreenshotManifest> | undefined;

export function loadScreenshotManifest(
  publicDir: URL,
): Promise<ScreenshotManifest> {
  manifest ??= readFile(
    new URL("screenshot-gallery/manifest.json", publicDir),
    "utf8",
  ).then((text) => parseScreenshotManifest(JSON.parse(text)));
  return manifest;
}
