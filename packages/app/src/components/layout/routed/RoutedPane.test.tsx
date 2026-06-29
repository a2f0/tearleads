import { expect, test } from "bun:test";
import type { MouseEvent as ReactMouseEvent } from "react";
import { initialRoutedSidebarExpanded, menuPositionBelow } from "./RoutedPane";

function fakeButton(rect: { left: number; bottom: number }): HTMLElement {
  return {
    getBoundingClientRect: () => rect as DOMRect,
  } as HTMLElement;
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
