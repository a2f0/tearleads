import { expect, test } from "bun:test";
import { act, fireEvent } from "@testing-library/react";
import {
  forceMobileRoutedTier,
  renderRoutedPane,
} from "./routedPane.testUtils";
import {
  initialRoutedPaneOverlaysState,
  isRoutedDrawerOpen,
  isRoutedSidebarExpanded,
  transitionRoutedPaneOverlays,
} from "./routedPaneOverlaysMachine";

test("routed overlay machine keeps mobile sidebar and drawer mutually exclusive", () => {
  let state = initialRoutedPaneOverlaysState(false);
  expect(state).toEqual({ status: "closed" });

  state = transitionRoutedPaneOverlays(state, {
    tier: "mobile",
    type: "toggle-sidebar",
  });
  expect(state).toEqual({ status: "sidebar" });

  state = transitionRoutedPaneOverlays(state, {
    tier: "mobile",
    type: "toggle-drawer",
  });
  expect(state).toEqual({ status: "drawer" });
  expect(isRoutedSidebarExpanded(state)).toBe(false);
  expect(isRoutedDrawerOpen(state)).toBe(true);

  state = transitionRoutedPaneOverlays(state, {
    tier: "mobile",
    type: "toggle-sidebar",
  });
  expect(state).toEqual({ status: "sidebar" });
  expect(isRoutedSidebarExpanded(state)).toBe(true);
  expect(isRoutedDrawerOpen(state)).toBe(false);
});

test("routed overlay machine lets tablet sidebar coexist with drawer and resets on tier change", () => {
  let state = initialRoutedPaneOverlaysState(true);
  state = transitionRoutedPaneOverlays(state, {
    tier: "tablet",
    type: "toggle-drawer",
  });
  expect(state).toEqual({ status: "sidebar-and-drawer" });

  const mobileState = transitionRoutedPaneOverlays(state, {
    tier: "mobile",
    type: "tier-changed",
  });
  expect(mobileState).toEqual({ status: "drawer" });

  const tabletState = transitionRoutedPaneOverlays(state, {
    tier: "tablet",
    type: "tier-changed",
  });
  expect(tabletState).toEqual({ status: "sidebar" });

  // No-op transitions preserve the exact state reference.
  expect(
    transitionRoutedPaneOverlays(tabletState, { type: "close-drawer" }),
  ).toBe(tabletState);
  expect(
    transitionRoutedPaneOverlays(
      { status: "closed" },
      { type: "close-sidebar" },
    ),
  ).toEqual({ status: "closed" });
  const closed = initialRoutedPaneOverlaysState(false);
  expect(transitionRoutedPaneOverlays(closed, { type: "close-sidebar" })).toBe(
    closed,
  );
});

test("a document-level modal Escape handler runs before the routed overlay listener", () => {
  const restoreMatchMedia = forceMobileRoutedTier();
  let view: ReturnType<typeof renderRoutedPane> | undefined;
  let modalEscapes = 0;
  const modalListener = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      modalEscapes += 1;
    }
  };

  try {
    view = renderRoutedPane();
    fireEvent.click(view.getByRole("button", { name: "Show Sidebar" }));
    expect(view.getByRole("dialog", { name: "Sidebar" })).toBeTruthy();

    // Register the modal listener AFTER the sidebar is already open.
    document.addEventListener("keydown", modalListener);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(modalEscapes).toBe(1);
    expect(view.getByRole("dialog", { name: "Sidebar" })).toBeTruthy();
  } finally {
    document.removeEventListener("keydown", modalListener);
    view?.unmount();
    restoreMatchMedia();
  }
});

test("mobile sidebar and launcher sheet close each other and Escape restores focus", () => {
  const restoreMatchMedia = forceMobileRoutedTier();
  let view: ReturnType<typeof renderRoutedPane> | undefined;

  try {
    view = renderRoutedPane();
    const sidebarButton = view.getByRole("button", { name: "Show Sidebar" });
    const menuButton = view.getByRole("button", { name: "Menu" });
    const sheet = view.container.querySelector(".routed-pane-sheet");

    // Open mobile sidebar; then open launcher sheet -> sidebar closes.
    fireEvent.click(sidebarButton);
    expect(view.getByRole("dialog", { name: "Sidebar" })).toBeTruthy();

    fireEvent.click(menuButton);
    expect(sheet?.getAttribute("data-open")).toBe("true");
    expect(view.queryByRole("dialog", { name: "Sidebar" })).toBeNull();

    // Open mobile sidebar while launcher sheet is open -> sheet closes.
    fireEvent.click(view.getByRole("button", { name: "Show Sidebar" }));
    expect(view.getByRole("dialog", { name: "Sidebar" })).toBeTruthy();
    expect(sheet?.getAttribute("data-open")).toBe("false");

    // Pressing Escape dismisses the mobile sidebar and returns focus to the
    // app bar's sidebar toggle button.
    act(() => {
      document.body.focus();
    });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(view.queryByRole("dialog", { name: "Sidebar" })).toBeNull();
    expect(document.activeElement).toBe(
      view.getByRole("button", { name: "Show Sidebar" }),
    );
  } finally {
    view?.unmount();
    restoreMatchMedia();
  }
});
