import { expect, test } from "bun:test";
import {
  findScreenshot,
  initialProject,
  projectLabel,
  type ScreenshotManifest,
  screenLabel,
  screenshotPageMeta,
  screenshotPath,
  screenshotRoutes,
  startingTheme,
} from "./screenshotsManifest";

const manifest: ScreenshotManifest = {
  projects: ["windowed", "mobile", "tablet"],
  themes: ["light", "dark"],
  screens: ["home", "explorer"],
  entries: [
    {
      project: "windowed",
      theme: "light",
      name: "explorer",
      src: "windowed",
      width: 2880,
      height: 1658,
    },
    {
      project: "mobile",
      theme: "light",
      name: "explorer",
      src: "mobile",
      width: 1170,
      height: 1992,
    },
    {
      project: "mobile",
      theme: "dark",
      name: "explorer",
      src: "mobile-dark",
      width: 1170,
      height: 1992,
    },
    {
      project: "mobile",
      theme: "light",
      name: "home",
      src: "mobile-home",
      width: 1170,
      height: 1992,
    },
    {
      project: "tablet",
      theme: "dark",
      name: "explorer",
      src: "tablet-dark",
      width: 1668,
      height: 2388,
    },
  ],
};

test("deep links preserve the selected platform when several captured the same screen", () => {
  const routes = screenshotRoutes(manifest);
  for (const platform of ["windowed", "mobile", "tablet"]) {
    const path = screenshotPath(platform, "explorer");
    expect(path).toBe(`/screenshots/${platform}/explorer/`);
    const route = routes.find(
      (candidate) => `/screenshots/${candidate.params.slug}/` === path,
    );
    expect(route).toBeDefined();
    expect(route?.props.initialScreen).toBe("explorer");
    expect(initialProject(manifest, route?.props.initialPlatform)).toBe(
      platform,
    );
  }
});

test("routes deduplicate themes and include only captured platform/screen pairs", () => {
  const slugs = screenshotRoutes(manifest).map((route) => route.params.slug);
  expect(slugs).toEqual([
    undefined,
    "windowed/explorer",
    "mobile/explorer",
    "mobile/home",
    "tablet/explorer",
  ]);
});

test("the gallery index uses the default platform and deep links honor their platform", () => {
  expect(initialProject(manifest, "tablet")).toBe("tablet");
  expect(initialProject(manifest, "unknown")).toBe("windowed");
  expect(initialProject(manifest, undefined)).toBe("windowed");
});

test("a build without captures retains only the gallery index", () => {
  const empty: ScreenshotManifest = {
    projects: [],
    themes: [],
    screens: [],
    entries: [],
  };
  expect(screenshotRoutes(empty)).toEqual([
    { params: { slug: undefined }, props: {} },
  ]);
  expect(initialProject(empty, undefined)).toBe("");
});

test("screenshot names cannot add path segments, queries, or fragments to links", () => {
  expect(screenshotPath("mobile", "notes/shared?view=full#detail")).toBe(
    "/screenshots/mobile/notes%2Fshared%3Fview%3Dfull%23detail/",
  );
});

test("findScreenshot matches project, theme, and screen exactly", () => {
  expect(findScreenshot(manifest, "mobile", "dark", "explorer")).toEqual({
    project: "mobile",
    theme: "dark",
    name: "explorer",
    src: "mobile-dark",
    width: 1170,
    height: 1992,
  });
  expect(findScreenshot(manifest, "windowed", "dark", "explorer")).toBe(
    undefined,
  );
  expect(findScreenshot(manifest, "tablet", "dark", "home")).toBe(undefined);
});

test("screen and layout labels use human names with a title-case fallback", () => {
  expect(screenLabel("drivers-license-detail")).toBe("Driver's license");
  expect(screenLabel("org-manager-grants")).toBe("Org Manager: Grants");
  expect(screenLabel("backup-restore")).toBe("Backup / Restore");
  expect(screenLabel("new-screen")).toBe("New Screen");
  expect(screenLabel("constructor")).toBe("Constructor");
  expect(projectLabel("windowed")).toBe("Desktop");
  expect(projectLabel("mobile")).toBe("Phone");
  expect(projectLabel("tablet")).toBe("Tablet");
});

test("the gallery opens in a theme that captured its opening screen", () => {
  // A dark-scheme visitor sees dark only where the opening screen has it.
  expect(startingTheme(manifest, "mobile", "explorer", true)).toBe("dark");
  expect(startingTheme(manifest, "windowed", "explorer", true)).toBe("light");
  // Without a requested screen the gallery opens on the platform's first
  // captured screen: mobile "home", which has no dark capture.
  expect(startingTheme(manifest, "mobile", undefined, true)).toBe("light");
  // A light-scheme visitor still gets dark when only dark was captured.
  expect(startingTheme(manifest, "tablet", "explorer", false)).toBe("dark");
  expect(startingTheme(manifest, "mobile", "explorer", false)).toBe("light");
});

test("each screen page names its screen, layout, and captured themes", () => {
  const pages = screenshotRoutes(manifest).map((route) =>
    screenshotPageMeta(
      manifest,
      route.props.initialPlatform,
      route.props.initialScreen,
    ),
  );
  expect(pages).toEqual([
    {
      title: "Screenshots | Tearleads",
      description:
        "Tearleads screens in desktop, tablet, and phone layouts, in light and dark themes.",
    },
    {
      title: "Explorer, desktop screenshot | Tearleads",
      description:
        "The Tearleads Explorer screen in the desktop layout, in the light theme.",
    },
    {
      title: "Explorer, phone screenshot | Tearleads",
      description:
        "The Tearleads Explorer screen in the phone layout, in light and dark themes.",
    },
    {
      title: "Home, phone screenshot | Tearleads",
      description:
        "The Tearleads Home screen in the phone layout, in the light theme.",
    },
    {
      title: "Explorer, tablet screenshot | Tearleads",
      description:
        "The Tearleads Explorer screen in the tablet layout, in the dark theme.",
    },
  ]);
  expect(new Set(pages.map((page) => page.title)).size).toBe(pages.length);
  expect(new Set(pages.map((page) => page.description)).size).toBe(
    pages.length,
  );
});

test("screen page descriptions list every captured theme in manifest order", () => {
  const themed: ScreenshotManifest = {
    ...manifest,
    themes: ["light", "dark", "high-contrast"],
    entries: ["dark", "light", "high-contrast"].map((theme) => ({
      project: "mobile",
      theme,
      name: "notes",
      src: theme,
      width: 1170,
      height: 1992,
    })),
  };
  expect(screenshotPageMeta(themed, "mobile", "notes").description).toBe(
    "The Tearleads Notes screen in the phone layout, in light, dark, and high contrast themes.",
  );
  expect(screenshotPageMeta(themed, "tablet", "notes").description).toBe(
    "The Tearleads Notes screen in the tablet layout.",
  );
});
