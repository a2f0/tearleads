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
  const callbacks: Array<() => void> = [];
  const original = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    readonly #callback: () => void;
    constructor(callback: () => void) {
      this.#callback = callback;
    }
    observe() {
      callbacks.push(this.#callback);
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;

  return {
    fire: () => {
      for (const callback of callbacks) callback();
    },
    restore: () => {
      globalThis.ResizeObserver = original;
    },
  };
}
