import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Stages the captured screenshots as static site assets. The capture run writes
// to `<repoRoot>/.screenshots/<project>/<theme>/<name>.png` (see
// packages/app-web/screenshots/capture.spec.ts); this copies canonical captures
// plus a scanned manifest into the Astro `public/` dir, which Astro serves at
// the site root in dev and copies into `dist/` on build — the same gitignored,
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
const PROJECTS = ["web", "mobile", "ipad"];

// Canonical screen order and allowlist, mirroring the capture specs. Treating
// this as an allowlist keeps removed or renamed themed files from a prior
// filtered job out of the gallery while standard and blame jobs safely
// preserve one another's current artifacts.
const SCREEN_ORDER = [
  "home",
  "explorer",
  "contacts",
  "org-manager",
  "org-manager-roster",
  "org-manager-groups",
  "org-manager-grants",
  "org-manager-organization",
  "org-manager-usage",
  "org-manager-billing",
  "notes",
  "identity-manager",
  "backup-restore",
  "system-monitor",
  "note-detail",
  "note-blame",
  "contact-detail",
  "drivers-license-detail",
];
const CANONICAL_SCREENS = new Set(SCREEN_ORDER);
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

// Short content digest, appended to each image URL as `?v=…`.
//
// Screenshot files have stable names, so a recaptured screen reuses its URL. A
// client that cached that URL under an earlier long-lived `Cache-Control` never
// revalidates it, and no origin header change or CDN purge can reach a cache
// that is not asking. Keying the URL on content sidesteps that entirely: a
// changed capture is simply a different URL, and the gallery reaches images only
// through this manifest, which is served revalidating.
async function contentVersion(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex")
    .slice(0, 8);
}

function screenRank(name: string): number {
  const index = SCREEN_ORDER.indexOf(name);
  return index === -1 ? SCREEN_ORDER.length : index;
}

function compareScreens(a: string, b: string): number {
  const rankDelta = screenRank(a) - screenRank(b);
  return rankDelta !== 0 ? rankDelta : a.localeCompare(b);
}

const entries: ScreenshotEntry[] = [];
const themesPresent = new Set<string>();
const screensPresent = new Set<string>();

for (const project of PROJECTS) {
  for (const theme of THEMES) {
    const files = (
      await listDir(path.join(SCREENSHOTS_DIR, project, theme))
    ).sort();
    for (const file of files) {
      if (!file.endsWith(".png")) {
        continue;
      }
      const name = file.slice(0, -".png".length);
      if (!CANONICAL_SCREENS.has(name)) {
        continue;
      }
      themesPresent.add(theme);
      screensPresent.add(name);
      entries.push({
        project,
        theme,
        name,
        src: `${IMG_URL_PREFIX}${project}/${theme}/${file}?v=${await contentVersion(
          path.join(SCREENSHOTS_DIR, project, theme, file),
        )}`,
      });
    }
  }
}

const manifest = {
  projects: PROJECTS.filter((project) =>
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
  for (const entry of entries) {
    const relativePath = path.join(
      entry.project,
      entry.theme,
      `${entry.name}.png`,
    );
    const destination = path.join(IMG_DIR, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(SCREENSHOTS_DIR, relativePath), destination);
  }
}
await Bun.write(MANIFEST_PATH, JSON.stringify(manifest));

console.log(
  entries.length > 0
    ? `Staged ${entries.length} screenshot(s) across ${manifest.projects.join(", ")} into public/screenshot-gallery/.`
    : "No screenshots found (.screenshots/ is empty); wrote an empty gallery manifest.",
);
