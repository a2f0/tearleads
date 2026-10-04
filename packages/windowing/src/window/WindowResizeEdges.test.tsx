import { afterEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { committedGeometry, renderDesktop } from "./desktop.testUtils";
import { stubLayout } from "./layout.testUtils";

afterEach(cleanup);

// A 300 x 200 window at (100, 100) on the 800 x 600 test surface.
function renderSizedWindow(position = { x: 100, y: 100 }) {
  const desktop = renderDesktop({
    position,
    size: { height: 200, width: 300 },
  });
  stubLayout(desktop.windowRoot, {
    clientHeight: 200,
    clientWidth: 300,
    offsetHeight: 200,
    offsetWidth: 300,
  });
  return desktop;
}

function dragHandle(
  windowRoot: HTMLElement,
  edge: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const handle = windowRoot.querySelector(`.window-resize--${edge}`);
  if (!handle) throw new Error(`resize handle ${edge} not rendered`);
  fireEvent.pointerDown(handle, { clientX: from.x, clientY: from.y });
  fireEvent.pointerMove(document, { clientX: to.x, clientY: to.y });
  act(() => {
    fireEvent.pointerUp(document);
  });
}

test("a window has a resize handle on every side and corner", () => {
  const { view, windowRoot } = renderSizedWindow();
  const edges = [...windowRoot.querySelectorAll(".window-resize")].map(
    (handle) => handle.className.replace("window-resize window-resize--", ""),
  );

  expect(edges).toEqual(["n", "e", "s", "w", "se", "sw", "ne", "nw"]);

  fireEvent.click(view.getByRole("button", { name: "Toggle maximize" }));

  expect(windowRoot.querySelector(".window-resize")).toBeNull();
});

test("a side handle resizes only its own axis", () => {
  const { view, windowRoot } = renderSizedWindow();

  dragHandle(windowRoot, "e", { x: 400, y: 200 }, { x: 460, y: 260 });

  expect(committedGeometry(view)).toEqual({
    position: { x: 100, y: 100 },
    size: { height: 200, width: 360 },
  });
});

test("the top handle moves the top edge and keeps the bottom in place", () => {
  const { view, windowRoot } = renderSizedWindow();

  dragHandle(windowRoot, "n", { x: 200, y: 100 }, { x: 260, y: 60 });

  expect(committedGeometry(view)).toEqual({
    position: { x: 100, y: 60 },
    size: { height: 240, width: 300 },
  });
});

test("the left handle stops at the surface's left edge", () => {
  const { view, windowRoot } = renderSizedWindow({ x: 40, y: 100 });

  dragHandle(windowRoot, "w", { x: 40, y: 200 }, { x: -100, y: 200 });

  expect(committedGeometry(view)).toEqual({
    position: { x: 0, y: 100 },
    size: { height: 200, width: 340 },
  });
});
