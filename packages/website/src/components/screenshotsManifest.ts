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
  web: "Windowed",
  mobile: "Mobile",
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
