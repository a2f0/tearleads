import {
  findScreenshot,
  projectInfo,
  type ScreenshotManifest,
  screenInfo,
  screenshotHeading,
  themeInfo,
} from "@a2f0/agent-tool/screenshots/manifest";

// Labels, routes, and the gallery itself come from `@a2f0/agent-tool`'s
// screenshot manifest, which the `screenshots` section of agent-tool.json
// configures. This module adds only what the Tearleads pages say about a
// screen: its heading, search title, and description.

/** Deep links live under /screenshots/<project>/<screen>/. */
export const SCREENSHOTS_BASE_PATH = "/screenshots";

/** Where the gallery and the home carousel fetch the staged manifest. */
export const SCREENSHOT_MANIFEST_URL = "/screenshot-gallery/manifest.json";

/** The gallery's `title-template`; screen pages render the same title. */
export const SCREENSHOT_TITLE_TEMPLATE = "{heading} | Tearleads";

interface ScreenshotPageMeta {
  /** The page's h1; the title adds the site name. */
  heading: string;
  title: string;
  description: string;
}

// ", in light and dark themes" or ", in the dark theme", in manifest order.
function themesClause(labels: string[]): string {
  const last = labels.pop();
  if (last === undefined) return "";
  if (labels.length === 0) return `, in the ${last} theme`;
  const list = labels.length === 1 ? labels[0] : `${labels.join(", ")},`;
  return `, in ${list} and ${last} themes`;
}

// Each screen route names its own screen, layout, and captured themes, so the
// gallery's pages have distinct headings, search titles, and descriptions. The
// index, with no project/screen pair, describes the whole gallery. The heading
// is the one the gallery writes as visitors move between screens.
export function screenshotPageMeta(
  manifest: ScreenshotManifest,
  project: string | undefined,
  screen: string | undefined,
): ScreenshotPageMeta {
  if (project === undefined || screen === undefined) {
    return {
      heading: "Screenshots",
      title: "Screenshots | Tearleads",
      description:
        "Tearleads screens in desktop, tablet, and phone layouts, in light and dark themes.",
    };
  }
  const layout = projectInfo(manifest, project).label.toLowerCase();
  const themes = manifest.themes
    .filter(
      (theme) =>
        findScreenshot(manifest, project, theme.name, screen) !== undefined,
    )
    .map((theme) => themeInfo(manifest, theme.name).label.toLowerCase());
  const heading = screenshotHeading(manifest, project, screen);
  return {
    heading,
    title: SCREENSHOT_TITLE_TEMPLATE.replace("{heading}", heading),
    description: `The Tearleads ${screenInfo(manifest, screen).label} screen in the ${layout} layout${themesClause(themes)}.`,
  };
}
