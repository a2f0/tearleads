/**
 * Forces the phone routed tier so a `useMiniAppCompactTableFrame` table folds
 * in happy-dom (which has no layout, so the frame-width half never fires).
 * Returns the restore function for `afterEach`.
 */
export function mockPhoneRoutedLayout(): () => void {
  const originalMatchMedia = Object.getOwnPropertyDescriptor(
    window,
    "matchMedia",
  );
  document.documentElement.setAttribute("data-navigation-mode", "routed");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      addEventListener: () => undefined,
      addListener: () => undefined,
      dispatchEvent: () => false,
      // Nothing matches, so the routed tier reads as "mobile".
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: () => undefined,
      removeListener: () => undefined,
    }),
  });

  return () => {
    document.documentElement.removeAttribute("data-navigation-mode");
    if (originalMatchMedia) {
      Object.defineProperty(window, "matchMedia", originalMatchMedia);
    } else {
      Reflect.deleteProperty(window, "matchMedia");
    }
  };
}

/** The muted second line's fields of each folded body row, as read aloud. */
export function getFoldedSecondaryTexts(table: HTMLElement): string[][] {
  return Array.from(table.querySelectorAll("tbody tr")).map((row) =>
    Array.from(
      row.querySelectorAll(
        ".mini-app-compact-table-line--muted .mini-app-compact-table-field",
      ),
      (field) => field.textContent ?? "",
    ),
  );
}
