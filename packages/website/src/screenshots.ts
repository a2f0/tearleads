import { publicDir } from "astro:config/server";
import { readFile } from "node:fs/promises";
import type { ScreenshotManifest } from "./components/screenshotsManifest";

// Server-only (build time). scripts/buildScreenshots.ts stages the manifest on
// predev/prebuild, before Astro runs; a build without captures gets an empty
// manifest, so callers must render correctly with no entries. Memoized so a
// build that renders many figures and routes reads the file once.
let manifest: Promise<ScreenshotManifest> | undefined;

export function loadScreenshotManifest(): Promise<ScreenshotManifest> {
  manifest ??= readFile(
    new URL("screenshot-gallery/manifest.json", publicDir),
    "utf8",
  ).then((text) => JSON.parse(text) as ScreenshotManifest);
  return manifest;
}
