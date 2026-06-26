import { afterEach, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { Menu } from "./Menu";
import { MenuItem } from "./MenuItem";

const originalGetBoundingClientRect =
  HTMLElement.prototype.getBoundingClientRect;
const originalInnerHeightDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "innerHeight",
);
const originalInnerWidthDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "innerWidth",
);

afterEach(() => {
  cleanup();
  HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  if (originalInnerHeightDescriptor) {
    Object.defineProperty(window, "innerHeight", originalInnerHeightDescriptor);
  }
  if (originalInnerWidthDescriptor) {
    Object.defineProperty(window, "innerWidth", originalInnerWidthDescriptor);
  }
});

function setViewportSize(input: { height: number; width: number }): void {
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: input.height,
  });
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: input.width,
  });
}

function mockMenuSize(input: { height: number; width: number }): void {
  HTMLElement.prototype.getBoundingClientRect =
    function getBoundingClientRect() {
      if (this instanceof HTMLElement && this.classList.contains("menu")) {
        return {
          bottom: input.height,
          height: input.height,
          left: 0,
          right: input.width,
          toJSON: () => ({}),
          top: 0,
          width: input.width,
          x: 0,
          y: 0,
        };
      }

      return originalGetBoundingClientRect.call(this);
    };
}

function mockMenuSizeByMeasurementLeft(input: {
  edgeWidth: number;
  fullWidth: number;
  height: number;
  shrinkAtLeft: number;
}): void {
  HTMLElement.prototype.getBoundingClientRect =
    function getBoundingClientRect() {
      if (this instanceof HTMLElement && this.classList.contains("menu")) {
        const measuredLeft = Number.parseFloat(this.style.left || "0");
        const width =
          measuredLeft >= input.shrinkAtLeft
            ? input.edgeWidth
            : input.fullWidth;

        return {
          bottom: input.height,
          height: input.height,
          left: measuredLeft,
          right: measuredLeft + width,
          toJSON: () => ({}),
          top: 0,
          width,
          x: measuredLeft,
          y: 0,
        };
      }

      return originalGetBoundingClientRect.call(this);
    };
}

test("renders into document.body so nested menus escape parent stacking contexts", () => {
  const view = render(
    <div data-testid="host">
      <Menu position={{ x: 24, y: 48 }} onClose={() => {}}>
        <MenuItem label="Open" onClick={() => {}} />
      </Menu>
    </div>,
  );

  const host = view.getByTestId("host");
  const item = view.getByText("Open");
  const menu = item.closest(".menu");

  expect(menu).toBeTruthy();
  expect(host.contains(item)).toBe(false);
  expect(document.body.contains(item)).toBe(true);
});

test("keeps upward-opening menus visible at the top of the viewport", async () => {
  setViewportSize({ height: 600, width: 800 });
  mockMenuSize({ height: 96, width: 180 });

  render(
    <Menu position={{ x: 24, y: 2 }} onClose={() => {}}>
      <MenuItem label="Open" onClick={() => {}} />
    </Menu>,
  );

  const menu = document.body.querySelector<HTMLElement>(".menu");
  expect(menu).toBeTruthy();
  await waitFor(() => {
    expect(menu?.style.top).toBe("8px");
    expect(menu?.style.left).toBe("24px");
    expect(menu?.style.visibility).toBe("");
  });
});

test("measures menus away from edge anchors so labels keep their full width", async () => {
  setViewportSize({ height: 600, width: 800 });
  mockMenuSizeByMeasurementLeft({
    edgeWidth: 42,
    fullWidth: 220,
    height: 120,
    shrinkAtLeft: 700,
  });

  render(
    <Menu direction="down" position={{ x: 790, y: 200 }} onClose={() => {}}>
      <MenuItem label="Move Forward Without Wrapping" onClick={() => {}} />
    </Menu>,
  );

  const menu = document.body.querySelector<HTMLElement>(".menu");
  expect(menu).toBeTruthy();
  await waitFor(() => {
    expect(menu?.style.left).toBe("572px");
    expect(menu?.style.top).toBe("200px");
    expect(menu?.style.maxWidth).toBe("784px");
  });
});

test("keeps downward-opening menus inside the lower-right viewport edge", async () => {
  setViewportSize({ height: 600, width: 800 });
  mockMenuSize({ height: 120, width: 180 });

  render(
    <Menu direction="down" position={{ x: 790, y: 590 }} onClose={() => {}}>
      <MenuItem label="Move Forward" onClick={() => {}} />
    </Menu>,
  );

  const menu = document.body.querySelector<HTMLElement>(".menu");
  expect(menu).toBeTruthy();
  await waitFor(() => {
    expect(menu?.style.top).toBe("472px");
    expect(menu?.style.left).toBe("612px");
    expect(menu?.style.maxHeight).toBe("584px");
    expect(menu?.style.maxWidth).toBe("784px");
  });
});
