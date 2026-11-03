import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import {
  type ScreenshotEntry,
  type ScreenshotManifest,
  screenshotRoutes,
} from "@a2f0/agent-tool/screenshots/manifest";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  SCREENSHOT_TITLE_TEMPLATE,
  SCREENSHOTS_BASE_PATH,
  screenshotPageMeta,
} from "./screenshotPages";

// The shared elements as the Tearleads pages configure them: what the gallery
// writes into the URL, title, and h1 while visitors move between screens must
// match what the build renders for that screen's own page, and the home
// carousel's slides must link to routes the build creates. agent-tool's own
// tests cover the elements' keyboard, lightbox, and focus behavior.

beforeAll(() =>
  GlobalRegistrator.register({
    url: "https://tearleads.test/screenshots/",
    width: 1440,
    height: 900,
  }),
);
afterAll(() => GlobalRegistrator.unregister());

function entry(project: string, theme: string, name: string): ScreenshotEntry {
  const [width, height] = project === "mobile" ? [1170, 2532] : [2880, 1658];
  return {
    project,
    theme,
    name,
    src: `/screenshot-gallery/img/${project}/${theme}/${name}.png?v=0`,
    width,
    height,
  };
}

const manifest: ScreenshotManifest = {
  schemaVersion: 1,
  projects: [
    { name: "windowed", label: "Desktop" },
    { name: "mobile", label: "Phone", frame: "phone" },
  ],
  themes: [
    { name: "light", label: "Light" },
    { name: "dark", label: "Dark" },
  ],
  screens: [
    { name: "explorer", label: "Explorer" },
    { name: "contacts", label: "Contacts" },
    { name: "notes", label: "Notes" },
  ],
  entries: [
    entry("windowed", "light", "explorer"),
    entry("mobile", "light", "explorer"),
    entry("mobile", "dark", "explorer"),
    entry("mobile", "dark", "contacts"),
    entry("mobile", "light", "notes"),
  ],
  capture: null,
};

interface Selectable extends HTMLElement {
  manifestData: ScreenshotManifest | null;
  step(delta: number): void;
}

function isSelectable(element: Element): element is Selectable {
  return (
    element instanceof HTMLElement &&
    "step" in element &&
    typeof element.step === "function"
  );
}

beforeEach(async () => {
  const { defineScreenshotElements } = await import(
    "@a2f0/agent-tool/screenshots/gallery"
  );
  defineScreenshotElements();
  document.body.replaceChildren();
  history.replaceState(null, "", "/screenshots/mobile/explorer/");
});

async function mount(
  tag: string,
  attributes: Record<string, string>,
): Promise<Selectable> {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  document.body.append(element);
  if (!isSelectable(element)) throw new Error(`<${tag}> is not registered`);
  element.manifestData = manifest;
  await Promise.resolve();
  return element;
}

test("stepping the gallery gives each screen its own page's heading and title", async () => {
  const heading = document.createElement("h1");
  heading.id = "page-title";
  document.body.append(heading);
  const gallery = await mount("screenshot-gallery", {
    "base-path": SCREENSHOTS_BASE_PATH,
    "heading-id": "page-title",
    "title-template": SCREENSHOT_TITLE_TEMPLATE,
    "initial-project": "mobile",
    "initial-screen": "explorer",
  });
  const visited: string[] = [];
  for (let step = 0; step < 3; step += 1) {
    gallery.step(1);
    const [, , project, screen] = location.pathname.split("/");
    const meta = screenshotPageMeta(manifest, project, screen);
    expect(document.title).toBe(meta.title);
    expect(heading.textContent).toBe(meta.heading);
    visited.push(location.pathname);
  }
  // Every URL the gallery writes is a route the build renders, and stepping
  // past the last phone screen wraps to the first.
  const routes = screenshotRoutes(manifest).map(
    (route) => `${SCREENSHOTS_BASE_PATH}/${route.params.slug}/`,
  );
  expect(visited).toEqual([
    "/screenshots/mobile/contacts/",
    "/screenshots/mobile/notes/",
    "/screenshots/mobile/explorer/",
  ]);
  for (const path of visited) expect(routes).toContain(path);
  expect(
    gallery.querySelector(".shots-gallery")?.getAttribute("data-frame"),
  ).toBe("phone");
});

test("the home carousel loops every phone screen and links to its page", async () => {
  const carousel = await mount("screenshot-carousel", {
    project: "mobile",
    "link-base": SCREENSHOTS_BASE_PATH,
    label: "Tearleads on a phone",
  });
  const slides = [
    ...carousel.querySelectorAll(".shots-carousel-slide:not([data-clone])"),
  ];
  expect(slides.map((slide) => slide.textContent)).toEqual([
    "Explorer",
    "Contacts",
    "Notes",
  ]);
  expect(
    carousel.querySelectorAll(".shots-carousel-slide[data-clone]").length,
  ).toBeGreaterThanOrEqual(slides.length * 2);
  expect(
    slides.map((slide) => slide.querySelector("a")?.getAttribute("href")),
  ).toEqual([
    "/screenshots/mobile/explorer/",
    "/screenshots/mobile/contacts/",
    "/screenshots/mobile/notes/",
  ]);
  expect(carousel.querySelectorAll(".shots-carousel-step")).toHaveLength(2);
});
