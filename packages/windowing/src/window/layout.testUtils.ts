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
