import { expect, test } from "bun:test";
import { fireEvent } from "@testing-library/react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { renderRoutedPane } from "../../../../test/helpers/routedPaneTestUtils";
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
  expect(initialRoutedSidebarExpanded("mobile", null)).toBe(false);
});

test("tablet honours each mini-app's configured sidebar default", () => {
  // explorer has no initialShowSidebar override, so it defaults to shown.
  expect(initialRoutedSidebarExpanded("tablet", "explorer")).toBe(true);
  // system-monitor opts out of the default-shown rail.
  expect(initialRoutedSidebarExpanded("tablet", "system-monitor")).toBe(false);
  expect(initialRoutedSidebarExpanded("tablet", null)).toBe(true);
});

test("mobile root route opens explorer as the compact home screen", () => {
  expect(resolveRoutedActiveMiniAppId("mobile", null)).toBe("explorer");
  expect(resolveRoutedActiveMiniAppId("mobile", "contacts")).toBe("contacts");
});

test("tablet root route keeps the routed home launcher", () => {
  expect(resolveRoutedActiveMiniAppId("tablet", null)).toBeNull();
  expect(resolveRoutedActiveMiniAppId("tablet", "contacts")).toBe("contacts");
});

test("invalid route app ids fall back without indexing missing mini-apps", () => {
  const legacyRouteAppId = "legacy-app" as MiniAppId;

  expect(resolveRoutedActiveMiniAppId("mobile", legacyRouteAppId)).toBe(
    "explorer",
  );
  expect(resolveRoutedActiveMiniAppId("tablet", legacyRouteAppId)).toBeNull();
});

test("mobile routed shell opens the nav drawer from the bottom menu bar", () => {
  const restoreMatchMedia = forceMobileRoutedTier();
  let view: ReturnType<typeof renderRoutedPane> | undefined;

  try {
    view = renderRoutedPane();
    const mobileBar = view.container.querySelector(".routed-pane-mobile-bar");
    expect(mobileBar).toBeTruthy();
    expect(view.container.querySelector(".routed-pane-hamburger")).toBeNull();

    const drawer = view.container.querySelector(".routed-pane-drawer");
    expect(drawer?.getAttribute("data-open")).toBe("false");

    const menuButton = view.getByRole("button", { name: "Menu" });
    expect(menuButton.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(menuButton);

    expect(menuButton.getAttribute("aria-expanded")).toBe("true");
    expect(drawer?.getAttribute("data-open")).toBe("true");
  } finally {
    view?.unmount();
    restoreMatchMedia();
  }
});

test("tablet routed shell collapses and expands the navigation rail", () => {
  const restoreMatchMedia = forceTabletRoutedTier();
  let view: ReturnType<typeof renderRoutedPane> | undefined;

  try {
    view = renderRoutedPane();

    expect(
      view.container
        .querySelector(".routed-pane-rail")
        ?.getAttribute("data-state"),
    ).toBe("open");
    expect(view.getByRole("link", { name: "Home" })).toBeTruthy();

    fireEvent.click(
      view.getByRole("button", { name: "Collapse navigation sidebar" }),
    );

    expect(
      view.container
        .querySelector(".routed-pane-rail")
        ?.getAttribute("data-state"),
    ).toBe("closed");
    expect(view.queryByRole("link", { name: "Home" })).toBeNull();
    expect(
      view
        .getByRole("button", { name: "Expand navigation sidebar" })
        .getAttribute("aria-expanded"),
    ).toBe("false");

    fireEvent.click(
      view.getByRole("button", { name: "Expand navigation sidebar" }),
    );

    expect(
      view.container
        .querySelector(".routed-pane-rail")
        ?.getAttribute("data-state"),
    ).toBe("open");
    expect(view.getByRole("link", { name: "Home" })).toBeTruthy();
  } finally {
    view?.unmount();
    restoreMatchMedia();
  }
});
