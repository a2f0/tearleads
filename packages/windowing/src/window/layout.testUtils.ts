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

type WindowSizeProperty = "offsetHeight" | "offsetWidth";

// Gives every window element its normal size, or the surface's full size while
// maximized, including the fresh element a restore mounts. Returns the undo.
export function stubWindowSizes(sizes: {
  maximized: { height: number; width: number };
  normal: { height: number; width: number };
}) {
  const prototype = HTMLElement.prototype;
  const dimensions = [
    ["offsetWidth", "width"],
    ["offsetHeight", "height"],
  ] as const;
  const originals = dimensions.map(
    ([property]) =>
      [property, Object.getOwnPropertyDescriptor(prototype, property)] as const,
  );
  for (const [property, dimension] of dimensions) {
    Object.defineProperty(prototype, property, {
      configurable: true,
      get(this: HTMLElement) {
        if (!this.classList.contains("window")) return 0;
        const maximized = this.classList.contains("window--maximized");
        return (maximized ? sizes.maximized : sizes.normal)[dimension];
      },
    });
  }

  return () => {
    for (const [property, descriptor] of originals) {
      if (descriptor) {
        Object.defineProperty(prototype, property, descriptor);
      } else {
        delete (prototype as Partial<Record<WindowSizeProperty, number>>)[
          property
        ];
      }
    }
  };
}
