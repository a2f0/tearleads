import { expect, test } from "bun:test";
import { act, fireEvent } from "@testing-library/react";
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

function getRoutedMain(container: HTMLElement): HTMLElement {
  const main = container.querySelector(".routed-pane-main");
  if (!(main instanceof HTMLElement)) {
    throw new Error("Expected routed pane main content.");
  }
  return main;
}

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

test("mobile routed shell hides the taskbar while a text input is focused", () => {
  const restoreMatchMedia = forceMobileRoutedTier();
  const viewport = installTestVisualViewport();
  let view: ReturnType<typeof renderRoutedPane> | undefined;

  try {
    view = renderRoutedPane();
    const input = document.createElement("input");
    getRoutedMain(view.container).append(input);

    act(() => input.focus());
    expect(
      view.container
        .querySelector(".routed-pane-taskbar")
        ?.hasAttribute("hidden"),
    ).toBe(false);

    viewport.setKeyboardVisible(true);
    expect(
      view.container
        .querySelector(".routed-pane-taskbar")
        ?.hasAttribute("hidden"),
    ).toBe(true);

    viewport.setKeyboardVisible(false);
    expect(
      view.container
        .querySelector(".routed-pane-taskbar")
        ?.hasAttribute("hidden"),
    ).toBe(false);

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    getRoutedMain(view.container).append(fileInput);
    act(() => fileInput.focus());
    viewport.setKeyboardVisible(true);
    expect(
      view.container
        .querySelector(".routed-pane-taskbar")
        ?.hasAttribute("hidden"),
    ).toBe(false);
  } finally {
    view?.unmount();
    viewport.restore();
    restoreMatchMedia();
  }
});

test("tablet routed shell keeps the taskbar while a text input is focused", () => {
  const restoreMatchMedia = forceTabletRoutedTier();
  const viewport = installTestVisualViewport();
  let view: ReturnType<typeof renderRoutedPane> | undefined;

  try {
    view = renderRoutedPane();
    const input = document.createElement("input");
    getRoutedMain(view.container).append(input);

    act(() => input.focus());
    viewport.setKeyboardVisible(true);
    expect(
      view.container
        .querySelector(".routed-pane-taskbar")
        ?.hasAttribute("hidden"),
    ).toBe(false);
  } finally {
    view?.unmount();
    viewport.restore();
    restoreMatchMedia();
  }
});

test("mobile nav sheet handle tap dismisses the menu", () => {
  const restoreMatchMedia = forceMobileRoutedTier();
  let view: ReturnType<typeof renderRoutedPane> | undefined;

  try {
    view = renderRoutedPane();
    fireEvent.click(view.getByRole("button", { name: "Menu" }));
    const handle = view.container.querySelector(
      ".routed-pane-sheet-handle",
    ) as HTMLButtonElement;

    fireEvent.pointerDown(handle, { button: 0, clientY: 600, pointerId: 1 });
    fireEvent.pointerMove(document, { clientY: 602, pointerId: 1 });
    fireEvent.pointerUp(document, { clientY: 602, pointerId: 1 });
    fireEvent.click(handle);

    expect(
      view.container
        .querySelector(".routed-pane-sheet")
        ?.getAttribute("data-open"),
    ).toBe("false");
  } finally {
    view?.unmount();
    restoreMatchMedia();
  }
});

test("mobile nav sheet handle snaps back after a short drag", () => {
  const restoreMatchMedia = forceMobileRoutedTier();
  let view: ReturnType<typeof renderRoutedPane> | undefined;

  try {
    view = renderRoutedPane();
    fireEvent.click(view.getByRole("button", { name: "Menu" }));
    const handle = view.container.querySelector(
      ".routed-pane-sheet-handle",
    ) as HTMLButtonElement;
    const sheet = view.container.querySelector(".routed-pane-sheet");

    fireEvent.pointerDown(handle, { button: 0, clientY: 600, pointerId: 1 });
    fireEvent.pointerMove(document, { clientY: 650, pointerId: 1 });
    expect((sheet as HTMLElement).style.transform).toBe("translateY(50px)");
    fireEvent.pointerUp(document, { clientY: 650, pointerId: 1 });
    fireEvent.click(handle);

    expect(sheet?.getAttribute("data-open")).toBe("true");
    expect((sheet as HTMLElement).style.transform).toBe("");
  } finally {
    view?.unmount();
    restoreMatchMedia();
  }
});

test("mobile nav sheet dismisses when its handle is dragged down", () => {
  const restoreMatchMedia = forceMobileRoutedTier();
  let view: ReturnType<typeof renderRoutedPane> | undefined;

  try {
    view = renderRoutedPane();
    const menuButton = view.getByRole("button", { name: "Menu" });
    const sheet = view.container.querySelector(".routed-pane-sheet");

    fireEvent.click(menuButton);
    const handle = view.container.querySelector(
      ".routed-pane-sheet-handle",
    ) as HTMLButtonElement;
    fireEvent.pointerDown(handle, {
      button: 0,
      clientY: 600,
      pointerId: 1,
    });
    fireEvent.pointerMove(document, {
      clientY: 700,
      pointerId: 1,
    });
    fireEvent.pointerUp(document, {
      clientY: 700,
      pointerId: 1,
    });
    expect(sheet?.getAttribute("data-open")).toBe("false");
    fireEvent.click(menuButton);

    expect(sheet?.getAttribute("data-open")).toBe("true");
  } finally {
    view?.unmount();
    restoreMatchMedia();
  }
});

test("mobile nav sheet pointer cancellation does not suppress the next tap", () => {
  const restoreMatchMedia = forceMobileRoutedTier();
  let view: ReturnType<typeof renderRoutedPane> | undefined;

  try {
    view = renderRoutedPane();
    fireEvent.click(view.getByRole("button", { name: "Menu" }));
    const handle = view.container.querySelector(
      ".routed-pane-sheet-handle",
    ) as HTMLButtonElement;
    const sheet = view.container.querySelector(".routed-pane-sheet");

    fireEvent.pointerDown(handle, { button: 0, clientY: 600, pointerId: 1 });
    fireEvent.pointerMove(document, { clientY: 650, pointerId: 1 });
    fireEvent.pointerCancel(document, { clientY: 650, pointerId: 1 });
    fireEvent.click(handle);

    expect(sheet?.getAttribute("data-open")).toBe("false");
  } finally {
    view?.unmount();
    restoreMatchMedia();
  }
});

test("mobile nav sheet keeps its menu open after an upward drag", () => {
  const restoreMatchMedia = forceMobileRoutedTier();
  let view: ReturnType<typeof renderRoutedPane> | undefined;

  try {
    view = renderRoutedPane();
    fireEvent.click(view.getByRole("button", { name: "Menu" }));
    const handle = view.container.querySelector(
      ".routed-pane-sheet-handle",
    ) as HTMLButtonElement;
    const sheet = view.container.querySelector(".routed-pane-sheet");

    fireEvent.pointerDown(handle, { button: 0, clientY: 600, pointerId: 1 });
    fireEvent.pointerMove(document, { clientY: 550, pointerId: 1 });
    fireEvent.pointerUp(document, { clientY: 550, pointerId: 1 });
    fireEvent.click(handle);

    expect(sheet?.getAttribute("data-open")).toBe("true");
  } finally {
    view?.unmount();
    restoreMatchMedia();
  }
});

test("tablet rail carries app links only", () => {
  const restoreMatchMedia = forceTabletRoutedTier();
  let view: ReturnType<typeof renderRoutedPane> | undefined;

  try {
    view = renderRoutedPane();
    fireEvent.click(
      view.getByRole("button", { name: "Expand navigation rail" }),
    );

    const rail = view.container.querySelector(".routed-pane-rail");
    if (!(rail instanceof HTMLElement)) {
      throw new Error("Expected the tablet navigation rail.");
    }

    // One link per routed mini-app...
    expect(rail.querySelectorAll("a").length).toBe(
      ROUTED_MINI_APP_NAV_ITEMS.length,
    );
    // ...each badged with its app glyph...
    expect(rail.querySelectorAll(".routed-pane-nav-link svg").length).toBe(
      ROUTED_MINI_APP_NAV_ITEMS.length,
    );
    // ...and no system or per-app contextual actions: those moved to the app
    // bar toolbar, leaving the rail toggle as the rail's only button.
    expect(rail.querySelectorAll("button").length).toBe(1);
    expect(rail.querySelector(".routed-pane-rail-toggle")).toBeTruthy();
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

    expect(
      view.container.querySelector(".routed-pane-title")?.textContent,
    ).toBe("Explorer");

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
