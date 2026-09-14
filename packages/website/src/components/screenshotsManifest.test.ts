import { expect, test } from "bun:test";
import {
  initialProject,
  type ScreenshotManifest,
  screenshotPath,
  screenshotRoutes,
} from "./screenshotsManifest";

const manifest: ScreenshotManifest = {
  projects: ["windowed", "mobile", "tablet"],
  themes: ["light", "dark"],
  screens: ["home", "explorer"],
  entries: [
    { project: "windowed", theme: "light", name: "explorer", src: "windowed" },
    { project: "mobile", theme: "light", name: "explorer", src: "mobile" },
    { project: "mobile", theme: "dark", name: "explorer", src: "mobile-dark" },
    { project: "mobile", theme: "light", name: "home", src: "mobile-home" },
    { project: "tablet", theme: "dark", name: "explorer", src: "tablet-dark" },
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
    expect(
      initialProject(
        manifest,
        route?.props.initialScreen,
        route?.props.initialPlatform,
      ),
    ).toBe(platform);
  }
});

test("routes deduplicate themes and include only captured platform/screen pairs", () => {
  const slugs = screenshotRoutes(manifest).map((route) => route.params.slug);
  expect(slugs).toEqual([
    undefined,
    "home",
    "explorer",
    "windowed/explorer",
    "mobile/explorer",
    "mobile/home",
    "tablet/explorer",
  ]);
});

test("legacy links select a platform that captured the requested screen", () => {
  const route = screenshotRoutes(manifest).find(
    (candidate) => candidate.params.slug === "home",
  );
  expect(route?.props).toEqual({ initialScreen: "home" });
  expect(
    initialProject(
      manifest,
      route?.props.initialScreen,
      route?.props.initialPlatform,
    ),
  ).toBe("mobile");
});

test("explicit platforms take precedence over screen fallback and unknown platforms do not", () => {
  expect(initialProject(manifest, "home", "tablet")).toBe("tablet");
  expect(initialProject(manifest, "home", "unknown")).toBe("mobile");
  expect(initialProject(manifest, "unknown", undefined)).toBe("windowed");
  expect(initialProject(manifest, undefined, undefined)).toBe("windowed");
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
  expect(initialProject(empty, undefined, undefined)).toBe("");
});

test("screenshot names cannot add path segments, queries, or fragments to links", () => {
  expect(screenshotPath("mobile", "notes/shared?view=full#detail")).toBe(
    "/screenshots/mobile/notes%2Fshared%3Fview%3Dfull%23detail",
  );
});
