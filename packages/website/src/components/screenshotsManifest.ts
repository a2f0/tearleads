// Mirror of the manifest shape written by scripts/buildScreenshots.ts. Kept in
// sync by hand (the script emits JSON; this reads it).
export interface ScreenshotEntry {
  project: string;
  theme: string;
  name: string;
  src: string;
}

export interface ScreenshotManifest {
  projects: string[];
  themes: string[];
  screens: string[];
  entries: ScreenshotEntry[];
}

// Friendlier labels for the device (capture project) toggle; falls back to a
// title-cased id for any project not listed here.
const PROJECT_LABELS: Record<string, string> = {
  windowed: "Windowed",
  mobile: "Mobile",
  tablet: "Tablet",
};

const THEME_LABELS: Record<string, string> = {
  light: "Light",
  dark: "Dark",
};

export function titleCase(value: string): string {
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

export function entryKey(project: string, theme: string, name: string): string {
  return `${project} ${theme} ${name}`;
}

export function screenshotPath(project: string, name: string): string {
  return `/screenshots/${encodeURIComponent(project)}/${encodeURIComponent(name)}`;
}

// Honor the deep-linked platform. Legacy screen-only links select the first
// project that captured that screen, since the default may not have it.
export function initialProject(
  manifest: ScreenshotManifest,
  screen: string | undefined,
  platform: string | undefined,
): string {
  if (platform && manifest.projects.includes(platform)) {
    return platform;
  }
  if (screen) {
    const withScreen = manifest.projects.find((project) =>
      manifest.entries.some(
        (entry) => entry.project === project && entry.name === screen,
      ),
    );
    if (withScreen) {
      return withScreen;
    }
  }
  return manifest.projects[0] ?? "";
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
    ...manifest.screens.map((slug) => ({
      params: { slug },
      props: { initialScreen: slug },
    })),
    ...Array.from(captures, ([slug, entry]) => ({
      params: { slug },
      props: { initialPlatform: entry.project, initialScreen: entry.name },
    })),
  ];
}
