import { afterEach, expect, test } from "bun:test";
import { act, fireEvent } from "@testing-library/react";
import {
  forceMobileRoutedTier,
  forceTabletRoutedTier,
  renderRoutedPane,
} from "../../../../test/helpers/routedPaneTestUtils";

afterEach(() => {
  globalThis.localStorage.removeItem("tearleads.launcher.placement");
});

test("tablet launcher can move between side rail and bottom sheet", () => {
  const restoreMatchMedia = forceTabletRoutedTier();
  const view = renderRoutedPane();

  try {
    const pane = view.container.querySelector(".routed-pane");
    expect(pane?.getAttribute("data-launcher-placement")).toBe("side");

    fireEvent.click(view.getByRole("button", { name: "Menu" }));
    const activeRailLink = view.container.querySelector(
      '.routed-pane-nav-link[aria-current="page"]',
    );
    expect(activeRailLink).toBeInstanceOf(HTMLElement);
    if (activeRailLink instanceof HTMLElement) {
      act(() => activeRailLink.focus());
      fireEvent.click(activeRailLink);
      expect(document.activeElement).toBe(activeRailLink);
    }

    fireEvent.click(
      view.getByRole("button", { name: "Move launcher to bottom" }),
    );
    expect(pane?.getAttribute("data-launcher-placement")).toBe("bottom");
    expect(
      globalThis.localStorage.getItem("tearleads.launcher.placement"),
    ).toBe("bottom");
    expect(view.container.querySelector(".routed-pane-rail")).toBeNull();

    const menuButton = view.getByRole("button", { name: "Menu" });
    expect(menuButton.getAttribute("aria-controls")).toBe("routed-pane-sheet");
    fireEvent.click(menuButton);
    expect(menuButton.getAttribute("aria-expanded")).toBe("true");
    expect(
      view.container
        .querySelector(".routed-pane-sheet")
        ?.getAttribute("data-open"),
    ).toBe("true");

    fireEvent.click(
      view.getByRole("button", { name: "Move launcher to side" }),
    );
    expect(pane?.getAttribute("data-launcher-placement")).toBe("side");
    expect(view.container.querySelector(".routed-pane-sheet")).toBeNull();
    expect(view.container.querySelector(".routed-pane-rail")).toBeTruthy();
    expect(
      view.getByRole("button", { name: "Menu" }).getAttribute("aria-expanded"),
    ).toBe("false");
  } finally {
    view.unmount();
    restoreMatchMedia();
  }
});

test("mobile launcher stays at the bottom without a placement control", () => {
  const restoreMatchMedia = forceMobileRoutedTier();
  const view = renderRoutedPane();

  try {
    expect(view.queryByRole("button", { name: /Move launcher to/ })).toBeNull();
    expect(
      view.getByRole("button", { name: "Menu" }).getAttribute("aria-controls"),
    ).toBe("routed-pane-sheet");
  } finally {
    view.unmount();
    restoreMatchMedia();
  }
});

for (const tier of ["tablet", "mobile"] as const) {
  test(`${tier} bottom launcher closes with Escape and restores focus`, () => {
    const restoreMatchMedia =
      tier === "tablet" ? forceTabletRoutedTier() : forceMobileRoutedTier();
    const view = renderRoutedPane();

    try {
      if (tier === "tablet") {
        fireEvent.click(
          view.getByRole("button", { name: "Move launcher to bottom" }),
        );
      }
      const menu = view.getByRole("button", { name: "Menu" });
      act(() => menu.focus());
      fireEvent.click(menu);
      expect(menu.getAttribute("aria-expanded")).toBe("true");
      expect(
        document.activeElement?.classList.contains("routed-pane-sheet-tile"),
      ).toBe(true);

      act(() => fireEvent.keyDown(document, { key: "Escape" }));
      expect(menu.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(menu);

      fireEvent.click(menu);
      fireEvent.click(view.getByRole("button", { name: "Close menu" }));
      expect(menu.getAttribute("aria-expanded")).toBe("false");
      expect(document.activeElement).toBe(menu);
    } finally {
      view.unmount();
      restoreMatchMedia();
    }
  });
}
