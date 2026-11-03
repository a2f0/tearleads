import { expect, test } from "bun:test";
import {
  type ScreenshotEntry,
  type ScreenshotManifest,
  screenshotRoutes,
} from "@a2f0/agent-tool/screenshots/manifest";
import { screenshotPageMeta } from "./screenshotPages";

function entry(
  project: string,
  theme: string,
  name: string,
  width: number,
  height: number,
): ScreenshotEntry {
  return { project, theme, name, src: `${project}-${theme}`, width, height };
}

// The labels agent-tool.json gives these projects and screens.
const manifest: ScreenshotManifest = {
  schemaVersion: 1,
  projects: [
    { name: "windowed", label: "Desktop" },
    { name: "mobile", label: "Phone", frame: "phone" },
    { name: "tablet", label: "Tablet" },
  ],
  themes: [
    { name: "light", label: "Light" },
    { name: "dark", label: "Dark" },
  ],
  screens: [
    { name: "home", label: "Home" },
    { name: "explorer", label: "Explorer" },
  ],
  entries: [
    entry("windowed", "light", "explorer", 2880, 1658),
    entry("mobile", "light", "explorer", 1170, 2532),
    entry("mobile", "dark", "explorer", 1170, 2532),
    entry("mobile", "light", "home", 1170, 2532),
    entry("tablet", "dark", "explorer", 1668, 2388),
  ],
  capture: null,
};

test("routes deduplicate themes and include only captured project/screen pairs", () => {
  expect(screenshotRoutes(manifest).map((route) => route.params.slug)).toEqual([
    undefined,
    "windowed/explorer",
    "mobile/explorer",
    "mobile/home",
    "tablet/explorer",
  ]);
});

test("each screen page's heading and metadata name its screen and layout", () => {
  const pages = screenshotRoutes(manifest).map((route) =>
    screenshotPageMeta(manifest, route.props.project, route.props.screen),
  );
  expect(pages).toEqual([
    {
      heading: "Screenshots",
      title: "Screenshots | Tearleads",
      description:
        "Tearleads screens in desktop, tablet, and phone layouts, in light and dark themes.",
    },
    {
      heading: "Explorer, desktop screenshot",
      title: "Explorer, desktop screenshot | Tearleads",
      description:
        "The Tearleads Explorer screen in the desktop layout, in the light theme.",
    },
    {
      heading: "Explorer, phone screenshot",
      title: "Explorer, phone screenshot | Tearleads",
      description:
        "The Tearleads Explorer screen in the phone layout, in light and dark themes.",
    },
    {
      heading: "Home, phone screenshot",
      title: "Home, phone screenshot | Tearleads",
      description:
        "The Tearleads Home screen in the phone layout, in the light theme.",
    },
    {
      heading: "Explorer, tablet screenshot",
      title: "Explorer, tablet screenshot | Tearleads",
      description:
        "The Tearleads Explorer screen in the tablet layout, in the dark theme.",
    },
  ]);
  for (const field of ["heading", "title", "description"] as const) {
    expect(new Set(pages.map((page) => page[field])).size).toBe(pages.length);
  }
});

test("screen page descriptions list every captured theme in manifest order", () => {
  const themed: ScreenshotManifest = {
    ...manifest,
    themes: [
      { name: "light", label: "Light" },
      { name: "dark", label: "Dark" },
      { name: "high-contrast", label: "High Contrast" },
    ],
    screens: [{ name: "notes", label: "Notes" }],
    entries: ["dark", "light", "high-contrast"].map((theme) =>
      entry("mobile", theme, "notes", 1170, 2532),
    ),
  };
  expect(screenshotPageMeta(themed, "mobile", "notes").description).toBe(
    "The Tearleads Notes screen in the phone layout, in light, dark, and high contrast themes.",
  );
  expect(screenshotPageMeta(themed, "tablet", "notes").description).toBe(
    "The Tearleads Notes screen in the tablet layout.",
  );
});
