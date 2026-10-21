import { afterAll, afterEach, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { phoneCarouselSlides } from "./phoneCarouselSlides";
import type {
  ScreenshotEntry,
  ScreenshotManifest,
} from "./screenshotsManifest";

GlobalRegistrator.register();
const { initPhoneCarouselSteps } = await import("./phoneCarouselSteps");

afterEach(() => {
  document.body.innerHTML = "";
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

function entry(project: string, theme: string, name: string): ScreenshotEntry {
  return {
    project,
    theme,
    name,
    src: `/screenshot-gallery/img/${project}-${theme}-${name}.png`,
    width: 1170,
    height: 1992,
  };
}

function manifest(entries: ScreenshotEntry[]): ScreenshotManifest {
  return {
    projects: [...new Set(entries.map((item) => item.project))],
    themes: [...new Set(entries.map((item) => item.theme))],
    screens: [...new Set(entries.map((item) => item.name))],
    entries,
  };
}

const screens = [
  { name: "explorer", caption: "Explorer", alt: "Explorer on a phone." },
  { name: "contacts", caption: "Contacts", alt: "Contacts on a phone." },
  { name: "notes", caption: "Notes", alt: "Notes on a phone." },
];

test("slides follow the screen order and skip screens without a light phone capture", () => {
  const slides = phoneCarouselSlides(
    manifest([
      entry("mobile", "light", "notes"),
      entry("mobile", "dark", "contacts"),
      entry("mobile", "light", "explorer"),
      entry("mobile", "dark", "explorer"),
      entry("windowed", "light", "contacts"),
    ]),
    screens,
  );
  expect(slides.map((slide) => slide.name)).toEqual(["explorer", "notes"]);
  expect(slides[0]?.dark?.src).toBe(
    "/screenshot-gallery/img/mobile-dark-explorer.png",
  );
  expect(slides[1]?.dark).toBeUndefined();
});

test("a row with fewer than two phones renders none", () => {
  expect(phoneCarouselSlides(manifest([]), screens)).toEqual([]);
  expect(
    phoneCarouselSlides(manifest([entry("mobile", "light", "notes")]), screens),
  ).toEqual([]);
});

interface Row {
  carousel: HTMLElement;
  track: HTMLElement;
  steps: HTMLElement;
  previous: HTMLButtonElement;
  next: HTMLButtonElement;
  scrolls: ScrollToOptions[];
}

// Five 264px phones with 24px gaps in a 600px track: two fit per step.
function renderRow(): Row {
  document.body.innerHTML = `
    <div data-phone-carousel>
      <div data-track>
        <ul style="column-gap: 24px">
          ${'<li class="phone-carousel-slide"></li>'.repeat(5)}
        </ul>
      </div>
      <div hidden data-steps>
        <button type="button" data-step="-1">Previous</button>
        <button type="button" data-step="1">Next</button>
      </div>
    </div>`;
  const carousel = document.querySelector<HTMLElement>("[data-phone-carousel]");
  const track = document.querySelector<HTMLElement>("[data-track]");
  const steps = document.querySelector<HTMLElement>("[data-steps]");
  const [previous, next] =
    document.querySelectorAll<HTMLButtonElement>("[data-step]");
  if (!carousel || !track || !steps || !previous || !next) {
    throw new Error("Carousel fixture did not render.");
  }
  for (const slide of document.querySelectorAll<HTMLElement>(
    ".phone-carousel-slide",
  )) {
    slide.getBoundingClientRect = () => ({ width: 264 }) as DOMRect;
  }
  let scrollLeft = 0;
  Object.defineProperties(track, {
    clientWidth: { configurable: true, get: () => 600 },
    scrollWidth: { configurable: true, get: () => 1416 },
    scrollLeft: {
      configurable: true,
      get: () => scrollLeft,
      set: (value: number) => {
        scrollLeft = value;
      },
    },
  });
  const scrolls: ScrollToOptions[] = [];
  track.scrollBy = ((options: ScrollToOptions) => {
    scrolls.push(options);
  }) as typeof track.scrollBy;
  return { carousel, track, steps, previous, next, scrolls };
}

function scrollTo(track: HTMLElement, left: number): void {
  track.scrollLeft = left;
  track.dispatchEvent(new Event("scroll"));
}

test("step buttons appear once wired and disable at each end of the row", () => {
  const row = renderRow();
  initPhoneCarouselSteps(row.carousel, () => false);
  expect(row.steps.hidden).toBe(false);
  expect(row.previous.disabled).toBe(true);
  expect(row.next.disabled).toBe(false);

  scrollTo(row.track, 400);
  expect(row.previous.disabled).toBe(false);
  expect(row.next.disabled).toBe(false);

  scrollTo(row.track, 816);
  expect(row.previous.disabled).toBe(false);
  expect(row.next.disabled).toBe(true);
});

test("each step scrolls by the phones that fit", () => {
  const row = renderRow();
  initPhoneCarouselSteps(row.carousel, () => false);
  row.next.click();
  scrollTo(row.track, 816);
  row.next.click();
  row.previous.click();
  expect(row.scrolls).toEqual([
    { left: 576, behavior: "smooth" },
    { left: -576, behavior: "smooth" },
  ]);
});

test("steps jump without animation under reduced motion", () => {
  const row = renderRow();
  initPhoneCarouselSteps(row.carousel, () => true);
  row.next.click();
  expect(row.scrolls).toEqual([{ left: 576, behavior: "auto" }]);
});
