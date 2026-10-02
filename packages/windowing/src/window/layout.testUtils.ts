type LayoutProperty =
  | "clientHeight"
  | "clientWidth"
  | "offsetHeight"
  | "offsetWidth";

// happy-dom does no layout, so window tests give the desktop surface and the
// window real dimensions for the clamp and resize math.
export function stubLayout(
  element: HTMLElement,
  sizes: Partial<Record<LayoutProperty, number>>,
) {
  for (const [property, value] of Object.entries(sizes)) {
    Object.defineProperty(element, property, {
      configurable: true,
      get: () => value,
    });
  }
}

// Replaces ResizeObserver with one whose callbacks the test fires by hand, as
// when a hidden surface is shown or the viewport resizes.
export function captureResizeObservers() {
  const observers: CapturedResizeObserver[] = [];
  const original = globalThis.ResizeObserver;

  class CapturedResizeObserver implements ResizeObserver {
    readonly #callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.#callback = callback;
    }
    observe() {
      observers.push(this);
    }
    unobserve() {}
    disconnect() {}
    fire() {
      this.#callback([], this);
    }
  }
  globalThis.ResizeObserver = CapturedResizeObserver;

  return {
    fire: () => {
      for (const observer of observers) observer.fire();
    },
    restore: () => {
      globalThis.ResizeObserver = original;
    },
  };
}
