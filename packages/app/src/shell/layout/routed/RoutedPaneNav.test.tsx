import { expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import {
  forceMobileRoutedTier,
  forceTabletRoutedTier,
  renderRoutedPane,
} from "../../../../test/helpers/routedPaneTestUtils";

test("tablet rail links leave modified clicks to the browser", () => {
  const restoreMatchMedia = forceTabletRoutedTier();
  let view: ReturnType<typeof renderRoutedPane> | undefined;

  try {
    view = renderRoutedPane();
    fireEvent.click(
      view.getByRole("button", { name: "Expand navigation rail" }),
    );
    const link = view.getByRole("link", { name: "Contacts" });
    expect(link.getAttribute("aria-current")).toBeNull();

    // Cmd/Ctrl-click and middle-click keep the browser default (open in a new
    // tab/window): the handler must not preventDefault, and no in-app
    // navigation happens — the active app is unchanged.
    expect(fireEvent.click(link, { metaKey: true })).toBe(true);
    expect(fireEvent.click(link, { ctrlKey: true })).toBe(true);
    expect(fireEvent.click(link, { button: 1 })).toBe(true);
    expect(link.getAttribute("aria-current")).toBeNull();

    // A plain left-click is intercepted for SPA navigation: prevented, and the
    // clicked app becomes the active one. Navigation remounts the routed
    // subtree (keyed by active app), so re-query the link.
    expect(fireEvent.click(link)).toBe(false);
    expect(
      view.getByRole("link", { name: "Contacts" }).getAttribute("aria-current"),
    ).toBe("page");
  } finally {
    view?.unmount();
    restoreMatchMedia();
  }
});

test("mobile sheet tiles leave modified clicks to the browser", () => {
  const restoreMatchMedia = forceMobileRoutedTier();
  let view: ReturnType<typeof renderRoutedPane> | undefined;

  try {
    view = renderRoutedPane();
    fireEvent.click(view.getByRole("button", { name: "Menu" }));
    const sheet = view.container.querySelector(".routed-pane-sheet");
    expect(sheet?.getAttribute("data-open")).toBe("true");

    const tile = view.getByRole("link", { name: "Contacts" });
    // A browser-handled click neither navigates in-app nor dismisses the
    // sheet.
    expect(fireEvent.click(tile, { shiftKey: true })).toBe(true);
    expect(sheet?.getAttribute("data-open")).toBe("true");
    expect(tile.getAttribute("aria-current")).toBeNull();

    // A plain left-click navigates and dismisses. Navigation remounts the
    // routed subtree (keyed by active app) and the dismissed sheet goes
    // aria-hidden, so re-query via the DOM rather than by role.
    expect(fireEvent.click(tile)).toBe(false);
    expect(
      view.container
        .querySelector(".routed-pane-sheet")
        ?.getAttribute("data-open"),
    ).toBe("false");
    expect(
      view.container.querySelector(
        '.routed-pane-sheet-tile[aria-current="page"]',
      )?.textContent,
    ).toBe("Contacts");
  } finally {
    view?.unmount();
    restoreMatchMedia();
  }
});
