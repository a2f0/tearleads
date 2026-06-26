import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { WindowTitleBar, type WindowTitleBarAction } from "./WindowTitleBar";

afterEach(() => cleanup());

function renderTitleBar({
  actions = [],
  onMouseDown = () => {},
}: {
  actions?: WindowTitleBarAction[];
  onMouseDown?: () => void;
} = {}) {
  return render(
    <WindowTitleBar
      title="Notes"
      actions={actions}
      onMouseDown={onMouseDown}
      onMinimize={() => {}}
      onMaximize={() => {}}
      onClose={() => {}}
      onMoveForward={() => {}}
      onMoveBackward={() => {}}
    />,
  );
}

test("renders only the standard window controls by default", () => {
  const view = renderTitleBar();

  expect(
    view.container.querySelectorAll(".window-titlebar-buttons > button"),
  ).toHaveLength(3);
});

test("renders title-bar actions before the standard window controls", () => {
  let pinCount = 0;
  const view = renderTitleBar({
    actions: [
      {
        icon: <span aria-hidden>pin</span>,
        id: "pin",
        label: "Pin to Desktop",
        onClick: () => {
          pinCount += 1;
        },
      },
    ],
  });

  expect(
    view.container.querySelectorAll(".window-titlebar-buttons > button"),
  ).toHaveLength(4);

  fireEvent.click(view.getByRole("button", { name: "Pin to Desktop" }));

  expect(pinCount).toBe(1);
});

test("starts dragging only for left-clicks on the draggable title area", () => {
  let mouseDownCalls = 0;
  const view = renderTitleBar({
    onMouseDown: () => {
      mouseDownCalls += 1;
    },
  });

  const titleBar = view.getByRole("toolbar");
  const title = view.getByText("Notes");
  const closeButton =
    view.container.querySelector<HTMLButtonElement>(".window-close");

  if (!closeButton) throw new Error("close button not found");

  fireEvent.mouseDown(titleBar, { button: 2 });
  fireEvent.mouseDown(closeButton, { button: 0 });
  fireEvent.mouseDown(title, { button: 0 });

  expect(mouseDownCalls).toBe(1);
});

test("opens the title-bar context menu without starting a drag", () => {
  let mouseDownCalls = 0;
  const view = renderTitleBar({
    onMouseDown: () => {
      mouseDownCalls += 1;
    },
  });

  const titleBar = view.getByRole("toolbar");

  fireEvent.mouseDown(titleBar, { button: 2 });
  fireEvent.contextMenu(titleBar, { clientX: 100, clientY: 120 });

  expect(mouseDownCalls).toBe(0);
  expect(view.getByText("Move Forward")).toBeTruthy();
  expect(view.getByText("Move Backward")).toBeTruthy();
});
