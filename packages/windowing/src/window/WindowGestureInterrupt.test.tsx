import { afterEach, expect, test } from "bun:test";
import { act, cleanup, fireEvent } from "@testing-library/react";
import { committedGeometry, renderDesktop } from "./desktop.testUtils";
import { stubLayout, stubWindowSizes } from "./layout.testUtils";

afterEach(cleanup);

// Maximizing or minimizing a window while a pointer gesture runs on it, as a
// second touch on the title bar's controls can, abandons the gesture.

const WINDOW_SIZES = {
  maximized: { height: 600, width: 800 },
  normal: { height: 100, width: 200 },
};

test("maximizing, minimizing, and restoring keeps the window's position", () => {
  const restoreSizes = stubWindowSizes(WINDOW_SIZES);
  try {
    const { view } = renderDesktop({ position: { x: 300, y: 200 } });

    fireEvent.click(view.getByRole("button", { name: "Toggle maximize" }));
    fireEvent.click(view.getByRole("button", { name: "Minimize notes" }));
    fireEvent.click(view.getByRole("button", { name: "Restore notes" }));
    fireEvent.click(view.getByRole("button", { name: "Toggle maximize" }));

    expect(committedGeometry(view).position).toEqual({ x: 300, y: 200 });
    expect(
      view.container.querySelector<HTMLElement>(".window")?.style.left,
    ).toBe("300px");
  } finally {
    restoreSizes();
  }
});

test("maximizing mid-drag abandons the drag and keeps the saved position", () => {
  const restoreSizes = stubWindowSizes(WINDOW_SIZES);
  try {
    const { view } = renderDesktop({ position: { x: 300, y: 200 } });
    const titleBar = view.getByRole("toolbar", { name: "Window controls" });

    fireEvent.pointerDown(titleBar, {
      clientX: 310,
      clientY: 210,
      pointerId: 1,
    });
    fireEvent.click(view.getByRole("button", { name: "Toggle maximize" }));
    fireEvent.pointerMove(document, { clientX: 20, clientY: 20, pointerId: 1 });
    act(() => {
      fireEvent.pointerUp(document, { pointerId: 1 });
    });
    fireEvent.click(view.getByRole("button", { name: "Toggle maximize" }));

    expect(committedGeometry(view).position).toEqual({ x: 300, y: 200 });
    expect(
      view.container.querySelector<HTMLElement>(".window")?.style.left,
    ).toBe("300px");
  } finally {
    restoreSizes();
  }
});

test("maximizing mid-resize abandons the resize and keeps the saved size", () => {
  const restoreSizes = stubWindowSizes(WINDOW_SIZES);
  try {
    const { view, windowRoot } = renderDesktop({
      position: { x: 100, y: 100 },
      size: { height: 200, width: 300 },
    });
    const corner = windowRoot.querySelector(".window-resize--se");
    if (!corner) throw new Error("resize corner not rendered");

    fireEvent.pointerDown(corner, { clientX: 400, clientY: 300, pointerId: 1 });
    fireEvent.pointerMove(document, {
      clientX: 450,
      clientY: 340,
      pointerId: 1,
    });
    expect(windowRoot.style.width).toBe("350px");
    fireEvent.click(view.getByRole("button", { name: "Toggle maximize" }));
    act(() => {
      fireEvent.pointerUp(document, { pointerId: 1 });
    });
    fireEvent.click(view.getByRole("button", { name: "Toggle maximize" }));

    expect(committedGeometry(view)).toEqual({
      position: { x: 100, y: 100 },
      size: { height: 200, width: 300 },
    });
    expect(
      view.container.querySelector<HTMLElement>(".window")?.style.width,
    ).toBe("300px");
  } finally {
    restoreSizes();
  }
});

test("minimizing mid-drag abandons the drag and restores where it was", () => {
  const { view, windowRoot } = renderDesktop({ position: { x: 300, y: 200 } });
  stubLayout(windowRoot, { offsetHeight: 100, offsetWidth: 200 });
  const titleBar = view.getByRole("toolbar", { name: "Window controls" });

  fireEvent.pointerDown(titleBar, { clientX: 310, clientY: 210, pointerId: 1 });
  fireEvent.pointerMove(document, { clientX: 110, clientY: 60, pointerId: 1 });
  expect(windowRoot.style.left).toBe("100px");
  fireEvent.click(view.getByRole("button", { name: "Minimize notes" }));
  act(() => {
    fireEvent.pointerUp(document, { pointerId: 1 });
  });
  fireEvent.click(view.getByRole("button", { name: "Restore notes" }));

  expect(committedGeometry(view).position).toEqual({ x: 300, y: 200 });
  expect(view.container.querySelector<HTMLElement>(".window")?.style.left).toBe(
    "300px",
  );
});

test("minimizing mid-resize abandons the resize and restores its size", () => {
  const { view, windowRoot } = renderDesktop({
    position: { x: 100, y: 100 },
    size: { height: 200, width: 300 },
  });
  stubLayout(windowRoot, { offsetHeight: 200, offsetWidth: 300 });
  const corner = windowRoot.querySelector(".window-resize--se");
  if (!corner) throw new Error("resize corner not rendered");

  fireEvent.pointerDown(corner, { clientX: 400, clientY: 300, pointerId: 1 });
  fireEvent.pointerMove(document, { clientX: 450, clientY: 340, pointerId: 1 });
  expect(windowRoot.style.width).toBe("350px");
  fireEvent.click(view.getByRole("button", { name: "Minimize notes" }));
  act(() => {
    fireEvent.pointerUp(document, { pointerId: 1 });
  });
  fireEvent.click(view.getByRole("button", { name: "Restore notes" }));

  expect(committedGeometry(view).size).toEqual({ height: 200, width: 300 });
  expect(
    view.container.querySelector<HTMLElement>(".window")?.style.width,
  ).toBe("300px");
});
