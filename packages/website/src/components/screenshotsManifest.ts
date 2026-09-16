// Mirror of the manifest shape written by scripts/buildScreenshots.ts. Kept in
// sync by hand (the script emits JSON; this reads it).
export interface ScreenshotEntry {
  project: string;
  theme: string;
  name: string;
  src: string;
  /** Pixel dimensions read from the PNG header at staging time. */
  width: number;
  height: number;
}

export interface ScreenshotManifest {
  projects: string[];
  themes: string[];
  screens: string[];
  entries: ScreenshotEntry[];
}

// Human labels for the capture projects (layouts); falls back to a title-cased
// id for any project not listed here. Route slugs keep the project ids.
const PROJECT_LABELS: Record<string, string> = {
  windowed: "Desktop",
  mobile: "Phone",
  tablet: "Tablet",
};

// Human labels for screen ids, matching the app's own names for each view. A
// Map, so an id such as "constructor" can never resolve to a prototype member.
const SCREEN_LABELS: ReadonlyMap<string, string> = new Map([
  ["home", "Home"],
  ["explorer", "Explorer"],
  ["contacts", "Contacts"],
  ["org-manager", "Org Manager"],
  ["org-manager-roster", "Org Manager: Roster"],
  ["org-manager-groups", "Org Manager: Groups"],
  ["org-manager-grants", "Org Manager: Grants"],
  ["org-manager-organization", "Org Manager: Organization"],
  ["org-manager-usage", "Org Manager: Usage"],
  ["org-manager-billing", "Org Manager: Billing"],
  ["notes", "Notes"],
  ["identity-manager", "Identity Manager"],
  ["backup-restore", "Backup / Restore"],
  ["system-monitor", "System Monitor"],
  ["note-detail", "Note"],
  ["note-blame", "Note authorship"],
  ["contact-detail", "Contact"],
  ["drivers-license-detail", "Driver's license"],
]);

const THEME_LABELS: Record<string, string> = {
  light: "Light",
  dark: "Dark",
};

function titleCase(value: string): string {
  return value
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function projectLabel(project: string): string {
  return PROJECT_LABELS[project] ?? titleCase(project);
}

export function themeLabel(theme: string): string {
  return THEME_LABELS[theme] ?? titleCase(theme);
}

export function screenLabel(name: string): string {
  return SCREEN_LABELS.get(name) ?? titleCase(name);
}

export function findScreenshot(
  manifest: ScreenshotManifest,
  project: string,
  theme: string,
  name: string,
): ScreenshotEntry | undefined {
  return manifest.entries.find(
    (entry) =>
      entry.project === project && entry.theme === theme && entry.name === name,
  );
}

export function entryKey(project: string, theme: string, name: string): string {
  return `${project} ${theme} ${name}`;
}

export function screenshotPath(project: string, name: string): string {
  return `/screenshots/${encodeURIComponent(project)}/${encodeURIComponent(name)}`;
}

// Deep links always include the capture platform; the index uses the first.
export function initialProject(
  manifest: ScreenshotManifest,
  platform: string | undefined,
): string {
  return platform && manifest.projects.includes(platform)
    ? platform
    : (manifest.projects[0] ?? "");
}

// The gallery opens in the visitor's color scheme only when the screen it opens
// on was captured in that theme; otherwise it uses the first theme that has the
// capture, so a partial manifest never opens on a missing-capture placeholder.
// The opening screen mirrors the gallery: the requested screen when this
// platform captured it, else the platform's first captured screen.
export function startingTheme(
  manifest: ScreenshotManifest,
  project: string,
  screen: string | undefined,
  prefersDark: boolean,
): string {
  const captured = (theme: string, name: string) =>
    manifest.entries.some(
      (entry) =>
        entry.project === project &&
        entry.theme === theme &&
        entry.name === name,
    );
  const screens = manifest.screens.filter((name) =>
    manifest.themes.some((theme) => captured(theme, name)),
  );
  const opening =
    screen !== undefined && screens.includes(screen) ? screen : screens[0];
  const order = prefersDark ? ["dark", ...manifest.themes] : manifest.themes;
  const theme = order.find(
    (candidate) =>
      manifest.themes.includes(candidate) &&
      (opening === undefined || captured(candidate, opening)),
  );
  return theme ?? manifest.themes[0] ?? "light";
}

interface ScreenshotRoute {
  params: { slug: string | undefined };
  props: { initialPlatform?: string; initialScreen?: string };
}

export function screenshotRoutes(
  manifest: ScreenshotManifest,
): ScreenshotRoute[] {
  // Light and dark captures share a route; unavailable platform/screen pairs
  // must not become valid URLs that silently open a different screenshot.
  const captures = new Map(
    manifest.entries.map((entry) => [`${entry.project}/${entry.name}`, entry]),
  );
  return [
    { params: { slug: undefined }, props: {} },
    ...Array.from(captures, ([slug, entry]) => ({
      params: { slug },
      props: { initialPlatform: entry.project, initialScreen: entry.name },
    })),
  ];
}
