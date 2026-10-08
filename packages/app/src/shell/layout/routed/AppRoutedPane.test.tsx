import { expect, test } from "bun:test";
import { act, fireEvent } from "@testing-library/react";
import {
  forceMobileRoutedTier,
  forceTabletRoutedTier,
  renderRoutedPane,
} from "../../../../test/helpers/routedPaneTestUtils";
import { ROUTED_MINI_APP_NAV_ITEMS } from "../../../mini-apps/catalog";
import { filterVisibleMiniAppItems } from "../../../mini-apps/miniAppVisibility";

// The windowing package's routed shell owns its own behavior (see its
// RoutedPane tests); these cover what the app puts into it.

// These shells render without a root session, so the root-only entry is hidden.
const VISIBLE_NAV_ITEMS = filterVisibleMiniAppItems(ROUTED_MINI_APP_NAV_ITEMS, {
  isRoot: false,
});

function installTestVisualViewport(): {
  setKeyboardVisible: (visible: boolean) => void;
  restore: () => void;
} {
  const original = window.visualViewport;
  const viewport = new EventTarget() as VisualViewport;
  Reflect.set(viewport, "height", window.innerHeight);
  Reflect.set(viewport, "scale", 1);
  Reflect.set(window, "visualViewport", viewport);

  return {
    setKeyboardVisible: (visible) => {
      Reflect.set(
        viewport,
        "height",
        visible ? window.innerHeight - 200 : window.innerHeight,
      );
      act(() => viewport.dispatchEvent(new Event("resize")));
    },
    restore: () => Reflect.set(window, "visualViewport", original),
  };
}

test("the root route opens Explorer as the routed home screen", () => {
  const restoreMatchMedia = forceTabletRoutedTier();
  let view: ReturnType<typeof renderRoutedPane> | undefined;

  try {
    view = renderRoutedPane();
    expect(
      view.container.querySelector(".routed-pane-title")?.textContent,
    ).toBe("Explorer");
  } finally {
    view?.unmount();
    restoreMatchMedia();
  }
});

test("the launcher offers the session's mini-apps, in menu order", () => {
  const restoreMatchMedia = forceMobileRoutedTier();
  let view: ReturnType<typeof renderRoutedPane> | undefined;

  try {
    view = renderRoutedPane();
    fireEvent.click(view.getByRole("button", { name: "Menu" }));
    const tiles = [
      ...view.container.querySelectorAll(".routed-pane-sheet-tile"),
    ].map((tile) => tile.textContent);

    expect(tiles).toEqual(VISIBLE_NAV_ITEMS.map(({ label }) => label));
    expect(view.queryByRole("link", { name: "Root" })).toBeNull();
  } finally {
    view?.unmount();
    restoreMatchMedia();
  }
});

test("routed shell docks the test-system warning directly above the taskbar", () => {
  const restoreMatchMedia = forceMobileRoutedTier();
  const viewport = installTestVisualViewport();
  let view: ReturnType<typeof renderRoutedPane> | undefined;

  try {
    view = renderRoutedPane();
    const banner = view.container.querySelector(".test-system-banner");
    expect(banner?.parentElement?.nextElementSibling?.className).toBe(
      "routed-pane-taskbar",
    );

    // The bar shares the taskbar's fate under the software keyboard: both give
    // the shrunken viewport back to the content the user is typing into.
    const input = document.createElement("input");
    view.container.querySelector(".routed-pane-main")?.append(input);
    act(() => input.focus());
    expect(banner?.hasAttribute("hidden")).toBe(false);

    viewport.setKeyboardVisible(true);
    expect(banner?.hasAttribute("hidden")).toBe(true);
  } finally {
    view?.unmount();
    viewport.restore();
    restoreMatchMedia();
  }
});
