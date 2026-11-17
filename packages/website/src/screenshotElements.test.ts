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
  // Contacts and notes carry the alt text agent-tool.json configures for them;
  // explorer falls back to its label.
  screens: [
    { name: "explorer", label: "Explorer" },
    {
      name: "contacts",
      label: "Contacts",
      alt: "Contacts: a list of people with their profile photos.",
    },
    {
      name: "notes",
      label: "Notes",
      alt: "Notes: a list of notes with the time each was modified.",
    },
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

test("the home carousel shows each phone screen once and links to its page", async () => {
  const carousel = await mount("screenshot-carousel", {
    project: "mobile",
    "link-base": SCREENSHOTS_BASE_PATH,
    label: "Tearleads on a phone",
    "view-all-href": "/screenshots/mobile/explorer/",
    "view-all-label": "All screenshots",
  });
  const slides = [...carousel.querySelectorAll(".shots-carousel-slide")];
  expect(slides.map((slide) => slide.textContent)).toEqual([
    "Explorer",
    "Contacts",
    "Notes",
  ]);
  // No loop copies: every slide is visible to assistive technology and in the
  // tab order, and its image keeps the alt text PhoneCarousel.astro renders,
  // the configured description or else the label.
  expect(carousel.querySelectorAll("[data-clone]")).toHaveLength(0);
  for (const slide of slides) {
    expect(slide.hasAttribute("aria-hidden")).toBe(false);
    expect(slide.querySelector("a")?.hasAttribute("tabindex")).toBe(false);
  }
  expect(
    slides.map((slide) => slide.querySelector("img")?.getAttribute("alt")),
  ).toEqual([
    "Explorer, phone screenshot",
    "Contacts: a list of people with their profile photos.",
    "Notes: a list of notes with the time each was modified.",
  ]);
  expect(
    slides.map((slide) => slide.querySelector("a")?.getAttribute("href")),
  ).toEqual([
    "/screenshots/mobile/explorer/",
    "/screenshots/mobile/contacts/",
    "/screenshots/mobile/notes/",
  ]);
  expect(carousel.querySelectorAll(".shots-carousel-step")).toHaveLength(2);
  // The view-all link leads the controls row, ahead of the step buttons, and
  // points at a route the build renders.
  const controls = carousel.querySelector(".shots-carousel-controls");
  const viewAll = controls?.firstElementChild;
  expect(viewAll?.className).toBe("shots-carousel-view-all");
  expect(viewAll?.textContent).toBe("All screenshots");
  const href = viewAll?.getAttribute("href");
  const routes = screenshotRoutes(manifest).map(
    (route) => `${SCREENSHOTS_BASE_PATH}/${route.params.slug}/`,
  );
  expect(routes).toContain(href ?? "");
});

// happy-dom has no layout. Until the returned function runs, every carousel is
// laid out as on a phone: 240px slides 264px apart behind 16px of padding, in a
// 390px track that scrolls only as far as its content and finishes each scroll
// at once. Installed before a carousel renders, so its first state is its own.
function simulatePhoneLayout(): () => void {
  const width = 390;
  const positions = new WeakMap<Element, number>();
  const isTrack = (element: Element) =>
    element.classList.contains("shots-carousel-track");
  const end = (track: Element) =>
    Math.max(
      0,
      2 * 16 +
        track.querySelectorAll(".shots-carousel-slide").length * 264 -
        24 -
        width,
    );
  const position = (track: Element) =>
    Math.min(end(track), Math.max(0, positions.get(track) ?? 0));
  const measures: Record<string, (element: HTMLElement) => number | null> = {
    offsetLeft: (element) =>
      element.classList.contains("shots-carousel-slide")
        ? 16 +
          [...(element.parentElement?.children ?? [])].indexOf(element) * 264
        : null,
    clientWidth: (element) => (isTrack(element) ? width : null),
    scrollWidth: (element) => (isTrack(element) ? width + end(element) : null),
    scrollLeft: (element) => (isTrack(element) ? position(element) : null),
  };
  const restores: (() => void)[] = [];
  function override(
    name: string,
    replace: (original: PropertyDescriptor | undefined) => PropertyDescriptor,
  ): void {
    const own = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
    let original = own;
    for (
      let proto: object | null = HTMLElement.prototype;
      !original && proto;
      proto = Object.getPrototypeOf(proto)
    ) {
      original = Object.getOwnPropertyDescriptor(proto, name);
    }
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      ...replace(original),
    });
    restores.push(() => {
      if (own) Object.defineProperty(HTMLElement.prototype, name, own);
      else Reflect.deleteProperty(HTMLElement.prototype, name);
    });
  }
  for (const [name, measure] of Object.entries(measures)) {
    override(name, (original) => ({
      get(this: HTMLElement) {
        return measure(this) ?? original?.get?.call(this);
      },
      set(this: HTMLElement, value: number) {
        if (isTrack(this)) positions.set(this, value);
        else original?.set?.call(this, value);
      },
    }));
  }
  override("scrollTo", (original) => ({
    writable: true,
    value(this: HTMLElement, ...args: unknown[]) {
      if (!isTrack(this)) return original?.value?.apply(this, args);
      const [options] = args as [ScrollToOptions];
      const before = position(this);
      positions.set(this, options.left ?? 0);
      if (position(this) !== before) this.dispatchEvent(new Event("scroll"));
    },
  }));
  return () => {
    for (const restore of restores.reverse()) restore();
  };
}

test("the home carousel stops at its last phone screen instead of wrapping", async () => {
  const removeLayout = simulatePhoneLayout();
  try {
    const carousel = await mount("screenshot-carousel", {
      project: "mobile",
      "link-base": SCREENSHOTS_BASE_PATH,
    });
    const track = carousel.querySelector<HTMLElement>(".shots-carousel-track");
    const [previous, next] = carousel.querySelectorAll<HTMLButtonElement>(
      ".shots-carousel-step",
    );
    if (!track || !previous || !next) {
      throw new Error("the carousel has no track or step buttons");
    }
    const unavailable = () =>
      [previous, next]
        .filter((button) => button.getAttribute("aria-disabled") === "true")
        .map((button) => button.dataset.step);
    // As rendered, before any scroll, it rests on the first screen, where only
    // the next step can move.
    expect([track.scrollLeft, unavailable()]).toEqual([0, ["-1"]]);
    // gallery.css rests a slide inside the padding; happy-dom reads inline
    // styles.
    track.style.setProperty("scroll-padding-left", "16px");
    const press = (button: HTMLButtonElement, times: number) =>
      Array.from({ length: times }, () => {
        button.click();
        return [track.scrollLeft, unavailable()];
      });
    // One slide fits, so each press moves one slide. The row ends partway into
    // the last, and a press there stays put rather than returning to the first
    // screen.
    expect(press(next, 3)).toEqual([
      [264, []],
      [410, ["1"]],
      [410, ["1"]],
    ]);
    // Back the same way, and a press at the start stays put rather than
    // jumping to the last screen.
    expect(press(previous, 3)).toEqual([
      [264, []],
      [0, ["-1"]],
      [0, ["-1"]],
    ]);
    // A button that cannot move is marked unavailable but never disabled, so
    // it can keep keyboard focus.
    expect([previous.disabled, next.disabled]).toEqual([false, false]);
  } finally {
    removeLayout();
  }
});
