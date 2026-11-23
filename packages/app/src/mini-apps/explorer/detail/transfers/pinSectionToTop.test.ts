import { afterEach, beforeEach, expect, test } from "bun:test";
import { pinSectionToTop } from "./pinSectionToTop";

// Resizes are fired by hand: happy-dom lays nothing out and observes nothing.
const resizeCallbacks = new Set<() => void>();
const originalObserver = globalThis.ResizeObserver;

beforeEach(() => {
  globalThis.ResizeObserver = class implements ResizeObserver {
    private readonly notify: () => void;
    constructor(callback: ResizeObserverCallback) {
      this.notify = () => callback([], this);
    }
    observe() {
      resizeCallbacks.add(this.notify);
    }
    unobserve() {
      resizeCallbacks.delete(this.notify);
    }
    disconnect() {
      resizeCallbacks.delete(this.notify);
    }
  };
});

afterEach(() => {
  resizeCallbacks.clear();
  globalThis.ResizeObserver = originalObserver;
  document.body.replaceChildren();
});

// A scroller at the top of the page whose second section starts `above`
// pixels into its content, read through the current scroll position.
function layOut(initialAbove: number) {
  const scroller = document.createElement("div");
  const first = document.createElement("section");
  const second = document.createElement("section");
  second.setAttribute("data-section", "second");
  scroller.append(first, second);
  document.body.append(scroller);
  const layout = { above: initialAbove };
  scroller.getBoundingClientRect = () => DOMRect.fromRect({ y: 0 });
  second.getBoundingClientRect = () =>
    DOMRect.fromRect({ y: layout.above - scroller.scrollTop });
  return { layout, scroller };
}

function resize() {
  for (const notify of resizeCallbacks) notify();
}

test("keeps the section at the top while the content above it grows", () => {
  const { layout, scroller } = layOut(175);
  const release = pinSectionToTop(scroller, '[data-section="second"]');
  expect(scroller.scrollTop).toBe(175);

  layout.above = 201;
  resize();
  expect(scroller.scrollTop).toBe(201);
  release();
});

for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) {
  test(`stops following once the user scrolls (${type})`, () => {
    const { layout, scroller } = layOut(175);
    pinSectionToTop(scroller, '[data-section="second"]');

    scroller.dispatchEvent(new Event(type));
    layout.above = 201;
    resize();
    expect(scroller.scrollTop).toBe(175);
  });
}

test("the release stops following and is safe to repeat", () => {
  const { layout, scroller } = layOut(175);
  const release = pinSectionToTop(scroller, '[data-section="second"]');
  release();
  release();
  layout.above = 201;
  resize();
  expect(scroller.scrollTop).toBe(175);
});

test("does nothing when no section matches", () => {
  const { scroller } = layOut(175);
  pinSectionToTop(scroller, '[data-section="missing"]');
  expect(scroller.scrollTop).toBe(0);
});
