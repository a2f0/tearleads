import { expect, test } from "bun:test";
import {
  findScreenshot,
  initialProject,
  projectLabel,
  type ScreenshotManifest,
  screenLabel,
  screenshotPath,
  screenshotRoutes,
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
    expect(path).toBe(`/screenshots/${platform}/explorer`);
    const route = routes.find(
      (candidate) => `/screenshots/${candidate.params.slug}` === path,
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
    "/screenshots/mobile/notes%2Fshared%3Fview%3Dfull%23detail",
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
