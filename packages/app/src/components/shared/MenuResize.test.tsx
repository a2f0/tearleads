import { afterEach, expect, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { Menu } from "./Menu";
import { MenuItem } from "./MenuItem";

const originalObserver = globalThis.ResizeObserver;
const originalBounds = HTMLElement.prototype.getBoundingClientRect;

afterEach(() => {
  cleanup();
  globalThis.ResizeObserver = originalObserver;
  HTMLElement.prototype.getBoundingClientRect = originalBounds;
});

test("an open menu stays above its anchor as observed content grows and shrinks", () => {
  let height = 96;
  let resize: (() => void) | undefined;
  let disconnected = false;
  globalThis.ResizeObserver = class implements ResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      resize = () => callback([], this);
    }
    observe() {}
    unobserve() {}
    disconnect() {
      disconnected = true;
    }
  };
  HTMLElement.prototype.getBoundingClientRect = function () {
    return this.classList.contains("menu")
      ? new DOMRect(24, 0, 180, height)
      : originalBounds.call(this);
  };

  const anchorY = window.innerHeight - 20;
  const view = render(
    <Menu position={{ x: 24, y: anchorY }} onClose={() => {}}>
      <MenuItem label="Open" onClick={() => {}} />
    </Menu>,
  );
  const menu = view.getByRole("button", { name: "Open" }).parentElement;
  expect(menu?.style.top).toBe(`${anchorY - height}px`);

  height = 360;
  act(() => resize?.());
  expect(menu?.style.top).toBe(`${anchorY - height}px`);
  expect(Number.parseFloat(menu?.style.top ?? "0")).toBeGreaterThanOrEqual(8);

  height = 48;
  act(() => resize?.());
  expect(menu?.style.top).toBe(`${anchorY - height}px`);
  view.unmount();
  expect(disconnected).toBe(true);
});
