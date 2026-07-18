import { expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { renderRoutedPane } from "../../../../test/helpers/routedPaneTestUtils";
import { ROUTED_MINI_APP_NAV_ITEMS } from "../../../mini-apps/registry";
import type { MiniAppId } from "../../../mini-apps/types";
import {
  initialRoutedSidebarExpanded,
  menuPositionBelow,
  resolveRoutedActiveMiniAppId,
} from "./RoutedPane";

function fakeButton(rect: { left: number; bottom: number }): HTMLElement {
  return {
    getBoundingClientRect: () => rect as DOMRect,
  } as HTMLElement;
}

function forceMobileRoutedTier(): () => void {
  const originalMatchMedia = window.matchMedia;

  window.matchMedia = ((query: string) => ({
    addEventListener: () => {},
    addListener: () => {},
    dispatchEvent: () => false,
    matches: false,
    media: query,
    onchange: null,
    removeEventListener: () => {},
    removeListener: () => {},
  })) as unknown as typeof window.matchMedia;

  return () => {
    window.matchMedia = originalMatchMedia;
  };
}

function forceTabletRoutedTier(): () => void {
  const originalMatchMedia = window.matchMedia;

  window.matchMedia = ((query: string) => ({
    addEventListener: () => {},
    addListener: () => {},
    dispatchEvent: () => false,
    matches: query.includes("min-width"),
    media: query,
    onchange: null,
    removeEventListener: () => {},
    removeListener: () => {},
  })) as unknown as typeof window.matchMedia;

  return () => {
    window.matchMedia = originalMatchMedia;
  };
}

test("menuPositionBelow derives a position from the anchor rect", () => {
  expect(menuPositionBelow(fakeButton({ left: 12, bottom: 34 }))).toEqual({
    x: 12,
    y: 34,
  });
});

test("the anchor is read synchronously, before React clears currentTarget", () => {
  // Reproduces the original crash: React nulls event.currentTarget once the
  // handler returns, so the Pane toggle must read the rect up front and only
  // *use* the captured value inside the deferred setState updater.
  const event = {
    currentTarget: fakeButton({ left: 5, bottom: 9 }),
  } as ReactMouseEvent<HTMLButtonElement>;

  // Mirror the handler: capture position synchronously...
  const captured = menuPositionBelow(event.currentTarget);

  // ...then React tears the event down before any deferred updater runs.
  (event as { currentTarget: HTMLElement | null }).currentTarget = null;
  const deferredUpdater = (open: boolean) => (open ? null : captured);

  expect(deferredUpdater(false)).toEqual({ x: 5, y: 9 });
});

test("mobile starts every mini-app with the sidebar collapsed", () => {
  // The mobile sidebar is a dismissable overlay, so it must not auto-open —
  // even for apps whose tablet default is shown (e.g. explorer).
  expect(initialRoutedSidebarExpanded("mobile", "explorer")).toBe(false);
  expect(initialRoutedSidebarExpanded("mobile", "contacts")).toBe(false);
  expect(initialRoutedSidebarExpanded("mobile", "system-monitor")).toBe(false);
});

test("tablet honours each mini-app's configured sidebar default", () => {
  // explorer has no initialShowSidebar override, so it defaults to shown.
  expect(initialRoutedSidebarExpanded("tablet", "explorer")).toBe(true);
  // system-monitor opts out of the default-shown rail.
  expect(initialRoutedSidebarExpanded("tablet", "system-monitor")).toBe(false);
});

test("the root route opens explorer as the routed home screen", () => {
  // Both routed tiers (mobile drawer and tablet rail) now land on Explorer as
  // the compact home instead of a launcher screen, so the root route always
  // resolves to it.
  expect(resolveRoutedActiveMiniAppId(null)).toBe("explorer");
  expect(resolveRoutedActiveMiniAppId("contacts")).toBe("contacts");
});

test("invalid route app ids fall back to explorer without indexing missing mini-apps", () => {
  const legacyRouteAppId = "legacy-app" as MiniAppId;

  expect(resolveRoutedActiveMiniAppId(legacyRouteAppId)).toBe("explorer");
});

test("mobile routed shell opens the nav sheet from the bottom menu bar", () => {
  const restoreMatchMedia = forceMobileRoutedTier();
  let view: ReturnType<typeof renderRoutedPane> | undefined;

  try {
    view = renderRoutedPane();
    const taskbar = view.container.querySelector(".routed-pane-taskbar");
    expect(taskbar).toBeTruthy();
    expect(view.container.querySelector(".routed-pane-hamburger")).toBeNull();

    const sheet = view.container.querySelector(".routed-pane-sheet");
    expect(sheet?.getAttribute("data-open")).toBe("false");

    // The sheet is a pure launcher of app tiles — no menu-list panel, so none
    // of the per-app contextual actions (Sync Lanes, Blob Browser) or the
    // system section ride along.
    expect(sheet?.querySelector(".routed-pane-nav-panel")).toBeNull();
    expect(sheet?.querySelectorAll(".routed-pane-sheet-tile").length ?? 0).toBe(
      ROUTED_MINI_APP_NAV_ITEMS.length,
    );

    const menuButton = view.getByRole("button", { name: "Menu" });
    expect(menuButton.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(menuButton);

    expect(menuButton.getAttribute("aria-expanded")).toBe("true");
    expect(sheet?.getAttribute("data-open")).toBe("true");

    // Once revealed, every routed mini-app is reachable as a tile. Home is not
    // among them: the root route resolves to Explorer, so a Home tile would
    // just be a second way to reach the Explorer tile's destination.
    expect(view.queryByRole("link", { name: "Home" })).toBeNull();
    expect(view.getByRole("link", { name: "Contacts" })).toBeTruthy();
  } finally {
    view?.unmount();
    restoreMatchMedia();
  }
});

test("tablet routed shell starts with the navigation rail collapsed", () => {
  const restoreMatchMedia = forceTabletRoutedTier();
  let view: ReturnType<typeof renderRoutedPane> | undefined;

  try {
    view = renderRoutedPane();

    // The tablet/iPad tier now carries the same bottom taskbar as mobile
    // (centered logo + mode switch) in addition to its persistent rail.
    expect(view.container.querySelector(".routed-pane-taskbar")).toBeTruthy();

    // The rail now defaults to collapsed, so its nav panel (and the app links)
    // stays hidden behind the toggle until the user expands it.
    expect(
      view.container
        .querySelector(".routed-pane-rail")
        ?.getAttribute("data-state"),
    ).toBe("closed");
    expect(view.queryByRole("link", { name: "Contacts" })).toBeNull();
    expect(
      view
        .getByRole("button", { name: "Expand navigation rail" })
        .getAttribute("aria-expanded"),
    ).toBe("false");

    fireEvent.click(
      view.getByRole("button", { name: "Expand navigation rail" }),
    );

    expect(
      view.container
        .querySelector(".routed-pane-rail")
        ?.getAttribute("data-state"),
    ).toBe("open");
    expect(view.getByRole("link", { name: "Contacts" })).toBeTruthy();

    fireEvent.click(
      view.getByRole("button", { name: "Collapse navigation rail" }),
    );

    expect(
      view.container
        .querySelector(".routed-pane-rail")
        ?.getAttribute("data-state"),
    ).toBe("closed");
    expect(view.queryByRole("link", { name: "Contacts" })).toBeNull();
  } finally {
    view?.unmount();
    restoreMatchMedia();
  }
});
