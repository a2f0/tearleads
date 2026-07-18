import { cp, mkdir, readdir, rm } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Stages the captured screenshots as static site assets. The capture run writes
// to `<repoRoot>/.screenshots/<project>/<theme>/<name>.png` (see
// packages/app-web/screenshots/capture.spec.ts); this copies that tree plus a
// scanned manifest into the Astro `public/` dir, which Astro serves at the site
// root in dev and copies into `dist/` on build — the same gitignored,
// regenerated-on-every-build contract as the favicons (see buildWebImages.sh).
//
// A no-op-friendly empty manifest is written when `.screenshots/` is absent, so
// `astro build` still succeeds in CI without a prior `bun run screenshots`.
//
// This script lives at packages/website/scripts/, so the repo root is three
// levels up.
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const SCREENSHOTS_DIR = path.join(REPO_ROOT, ".screenshots");
const OUTPUT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  "screenshot-gallery",
);
const IMG_DIR = path.join(OUTPUT_DIR, "img");
const MANIFEST_PATH = path.join(OUTPUT_DIR, "manifest.json");

// URL prefix the gallery UI loads images from (served from public/).
const IMG_URL_PREFIX = "/screenshot-gallery/img/";

// Canonical screen order, mirroring the capture spec's screen lists so the
// filmstrip reads top-to-bottom the way a person walks the app. Names not in
// this list sort after it, alphabetically.
const SCREEN_ORDER = [
  "home",
  "explorer",
  "contacts",
  "org-manager",
  "notes",
  "identity-manager",
  "backup-restore",
  "system-monitor",
  "note-detail",
  "contact-detail",
  "drivers-license-detail",
];
const THEMES = ["light", "dark"];

interface ScreenshotEntry {
  project: string;
  theme: string;
  name: string;
  src: string;
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    // A missing `.screenshots/` (never captured) is the common, expected case.
    // Any other failure (permissions, I/O, not-a-directory) means the captures
    // are broken — rethrow so the build fails loudly instead of silently
    // staging an empty or partial gallery.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

function screenRank(name: string): number {
  const index = SCREEN_ORDER.indexOf(name);
  return index === -1 ? SCREEN_ORDER.length : index;
}

function compareScreens(a: string, b: string): number {
  const rankDelta = screenRank(a) - screenRank(b);
  return rankDelta !== 0 ? rankDelta : a.localeCompare(b);
}

const projects = (await listDir(SCREENSHOTS_DIR)).sort();
const entries: ScreenshotEntry[] = [];
const themesPresent = new Set<string>();
const screensPresent = new Set<string>();

for (const project of projects) {
  for (const theme of THEMES) {
    const files = await listDir(path.join(SCREENSHOTS_DIR, project, theme));
    for (const file of files) {
      if (!file.endsWith(".png")) {
        continue;
      }
      themesPresent.add(theme);
      screensPresent.add(file.slice(0, -".png".length));
      entries.push({
        project,
        theme,
        name: file.slice(0, -".png".length),
        src: `${IMG_URL_PREFIX}${project}/${theme}/${file}`,
      });
    }
  }
}

const manifest = {
  projects: projects.filter((project) =>
    entries.some((entry) => entry.project === project),
  ),
  themes: THEMES.filter((theme) => themesPresent.has(theme)),
  screens: [...screensPresent].sort(compareScreens),
  entries,
};

// Rewrite the whole gallery dir so a removed screenshot never lingers.
await rm(OUTPUT_DIR, { force: true, recursive: true });
await mkdir(OUTPUT_DIR, { recursive: true });
if (entries.length > 0) {
  // The `.screenshots/` tree already matches the `IMG_URL_PREFIX` layout.
  await cp(SCREENSHOTS_DIR, IMG_DIR, { recursive: true });
}
await Bun.write(MANIFEST_PATH, JSON.stringify(manifest));

console.log(
  entries.length > 0
    ? `Staged ${entries.length} screenshot(s) across ${manifest.projects.join(", ")} into public/screenshot-gallery/.`
    : "No screenshots found (.screenshots/ is empty); wrote an empty gallery manifest.",
);
