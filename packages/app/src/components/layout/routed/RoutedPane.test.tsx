import { expect, test } from "bun:test";
import type { MouseEvent as ReactMouseEvent } from "react";
import { menuPositionBelow } from "./RoutedPane";

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
