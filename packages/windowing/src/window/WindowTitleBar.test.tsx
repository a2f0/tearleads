import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { WindowTitleBar } from "./WindowTitleBar";

afterEach(() => cleanup());

function renderTitleBar({
  onPointerDown = () => {},
}: {
  onPointerDown?: () => void;
} = {}) {
  return render(
    <WindowTitleBar
      title="Notes"
      onPointerDown={onPointerDown}
      onMinimize={() => {}}
      onMaximize={() => {}}
      onClose={() => {}}
      onMoveForward={() => {}}
      onMoveBackward={() => {}}
    />,
  );
}

test("renders only the standard window controls", () => {
  const view = renderTitleBar();

  expect(
    view.container.querySelectorAll(".window-titlebar-buttons > button"),
  ).toHaveLength(3);
});

test("starts dragging only for left-clicks on the draggable title area", () => {
  let pointerDownCalls = 0;
  const view = renderTitleBar({
    onPointerDown: () => {
      pointerDownCalls += 1;
    },
  });

  const titleBar = view.getByRole("toolbar");
  const title = view.getByText("Notes");
  const closeButton =
    view.container.querySelector<HTMLButtonElement>(".window-close");

  if (!closeButton) throw new Error("close button not found");

  fireEvent.pointerDown(titleBar, { button: 2 });
  fireEvent.pointerDown(closeButton, { button: 0 });
  fireEvent.pointerDown(title, { button: 0 });

  expect(pointerDownCalls).toBe(1);
});

test("opens the title-bar context menu without starting a drag", () => {
  let pointerDownCalls = 0;
  const view = renderTitleBar({
    onPointerDown: () => {
      pointerDownCalls += 1;
    },
  });

  const titleBar = view.getByRole("toolbar");

  fireEvent.pointerDown(titleBar, { button: 2 });
  fireEvent.contextMenu(titleBar, { clientX: 100, clientY: 120 });

  expect(pointerDownCalls).toBe(0);
  expect(view.getByText("Move Forward")).toBeTruthy();
  expect(view.getByText("Move Backward")).toBeTruthy();
});

test("pressing a context-menu icon does not start a drag", () => {
  let pointerDownCalls = 0;
  const view = renderTitleBar({
    onPointerDown: () => {
      pointerDownCalls += 1;
    },
  });

  fireEvent.contextMenu(view.getByRole("toolbar"), {
    clientX: 100,
    clientY: 120,
  });
  const icon = view
    .getByText("Move Forward")
    .closest("button")
    ?.querySelector("svg");
  if (!icon) throw new Error("menu icon not rendered");
  fireEvent.pointerDown(icon, { button: 0 });

  expect(pointerDownCalls).toBe(0);
});
