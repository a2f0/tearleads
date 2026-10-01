import { afterEach, expect, spyOn, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
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

test("closes when the page scrolls but not when the menu itself does", () => {
  let closes = 0;
  const view = render(
    <Menu
      position={{ x: 24, y: 48 }}
      onClose={() => {
        closes += 1;
      }}
    >
      <MenuItem label="Open" onClick={() => {}} />
    </Menu>,
  );
  const menu = view.getByText("Open").closest(".menu");
  if (!(menu instanceof HTMLElement)) {
    throw new Error("Expected the menu element.");
  }

  // The menu's own overflow, and anything inside it, is the menu working.
  fireEvent.scroll(menu);
  fireEvent.scroll(view.getByText("Open"));
  expect(closes).toBe(0);

  fireEvent.scroll(document.body);
  expect(closes).toBe(1);
});

test("calls the latest inline closer, not a stale one", () => {
  const calls: string[] = [];
  const menuAt = (label: string) => (
    <Menu
      position={{ x: 24, y: 48 }}
      onClose={() => {
        calls.push(label);
      }}
    >
      <MenuItem label="Open" onClick={() => {}} />
    </Menu>
  );
  const view = render(menuAt("first"));
  view.rerender(menuAt("second"));

  fireEvent.scroll(document.body);
  fireEvent.mouseDown(document.body);

  expect(calls).toEqual(["second", "second"]);
});

test("subscribes its document listeners once across re-renders", () => {
  const addListener = spyOn(document, "addEventListener");
  try {
    const calls: string[] = [];
    const menuAt = (label: string) => (
      <Menu position={{ x: 24, y: 48 }} onClose={() => calls.push(label)}>
        <MenuItem label="Open" onClick={() => {}} />
      </Menu>
    );
    // The keyboard hook adds its own mousedown listener once placement is
    // ready, so assert no growth rather than an absolute count.
    const registrations = () =>
      addListener.mock.calls
        .map(([type]) => type)
        .filter((type) => type === "scroll" || type === "mousedown").length;
    const view = render(menuAt("first"));
    const afterMount = registrations();
    expect(afterMount).toBeGreaterThan(0);

    view.rerender(menuAt("second"));
    view.rerender(menuAt("third"));
    expect(registrations()).toBe(afterMount);
  } finally {
    addListener.mockRestore();
  }
});

// Give one element a scroll range without touching the prototype; the
// element is discarded with the render, so nothing needs restoring.
function mockScrollRange(
  element: HTMLElement,
  input: {
    clientHeight: number;
    scrollHeight: number;
  },
): void {
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    get: () => input.scrollHeight,
  });
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    get: () => input.clientHeight,
  });
}

function menuWithList(anchorY: number) {
  return (
    <Menu position={{ x: 24, y: anchorY }} onClose={() => {}}>
      <div data-testid="list" style={{ overflowY: "auto" }}>
        <MenuItem label="Open" onClick={() => {}} />
      </div>
    </Menu>
  );
}

test("flags a menu whose own box overflows so touch may pan it", () => {
  const view = render(menuWithList(48));
  const menu = view.getByText("Open").closest(".menu");
  if (!(menu instanceof HTMLElement)) {
    throw new Error("Expected the menu element.");
  }
  // Fits: no scroll range, so the stylesheet consumes touch gestures.
  expect(menu.hasAttribute("data-scrollable")).toBe(false);

  mockScrollRange(menu, { clientHeight: 200, scrollHeight: 400 });
  view.rerender(menuWithList(48));
  expect(menu.getAttribute("data-scrollable")).toBe("true");
});

test("flags a menu whose inner scroll container overflows", () => {
  const view = render(menuWithList(48));
  const menu = view.getByText("Open").closest(".menu");
  if (!(menu instanceof HTMLElement)) {
    throw new Error("Expected the menu element.");
  }
  expect(menu.hasAttribute("data-scrollable")).toBe(false);

  // The menu box fits; only the list inside it (a select menu's option list,
  // say) has a scroll range. Touch must still be able to pan that list.
  mockScrollRange(view.getByTestId("list"), {
    clientHeight: 200,
    scrollHeight: 400,
  });
  view.rerender(menuWithList(48));
  expect(menu.getAttribute("data-scrollable")).toBe("true");
});

test("a spurious pixel of overflow still counts as fitting", () => {
  const view = render(menuWithList(48));
  const menu = view.getByText("Open").closest(".menu");
  if (!(menu instanceof HTMLElement)) {
    throw new Error("Expected the menu element.");
  }

  mockScrollRange(menu, { clientHeight: 200, scrollHeight: 201 });
  view.rerender(menuWithList(48));
  expect(menu.hasAttribute("data-scrollable")).toBe(false);
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
