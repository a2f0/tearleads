import { expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useLongPress } from "./useLongPress";

function TouchTarget({
  enabled,
  onClick,
  onContextMenu,
}: {
  enabled: boolean;
  onClick: () => void;
  onContextMenu: () => void;
}) {
  const longPress = useLongPress(enabled);
  return (
    <button
      type="button"
      {...longPress}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      target
    </button>
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// LONG_PRESS_DELAY_MS in the hook is 450ms; wait comfortably past it.
const PAST_LONG_PRESS_MS = 550;

test("a touch long-press opens the context menu and swallows the synthesized click", async () => {
  let clicks = 0;
  let contextMenus = 0;
  const view = render(
    <TouchTarget
      enabled
      onClick={() => {
        clicks += 1;
      }}
      onContextMenu={() => {
        contextMenus += 1;
      }}
    />,
  );
  const button = view.getByRole("button", { name: "target" });

  fireEvent.pointerDown(button, {
    pointerType: "touch",
    clientX: 5,
    clientY: 5,
  });
  await wait(PAST_LONG_PRESS_MS);

  expect(contextMenus).toBe(1);

  // The release synthesizes a click; the hook's capturing listener must cancel
  // it so the row's onClick (navigate/select) does not also fire.
  fireEvent.pointerUp(button, { pointerType: "touch", clientX: 5, clientY: 5 });
  fireEvent.click(button);
  expect(clicks).toBe(0);

  // A later, unrelated tap still clicks normally (suppressor was one-shot).
  fireEvent.click(button);
  expect(clicks).toBe(1);

  view.unmount();
  cleanup();
});

test("a normal tap (no long hold) clicks without opening a context menu", async () => {
  let clicks = 0;
  let contextMenus = 0;
  const view = render(
    <TouchTarget
      enabled
      onClick={() => {
        clicks += 1;
      }}
      onContextMenu={() => {
        contextMenus += 1;
      }}
    />,
  );
  const button = view.getByRole("button", { name: "target" });

  fireEvent.pointerDown(button, {
    pointerType: "touch",
    clientX: 5,
    clientY: 5,
  });
  fireEvent.pointerUp(button, { pointerType: "touch", clientX: 5, clientY: 5 });
  fireEvent.click(button);

  expect(contextMenus).toBe(0);
  expect(clicks).toBe(1);

  view.unmount();
  cleanup();
});

test("a mouse pointer never triggers the long-press path", async () => {
  let contextMenus = 0;
  const view = render(
    <TouchTarget
      enabled
      onClick={() => {}}
      onContextMenu={() => {
        contextMenus += 1;
      }}
    />,
  );
  const button = view.getByRole("button", { name: "target" });

  fireEvent.pointerDown(button, {
    pointerType: "mouse",
    clientX: 5,
    clientY: 5,
  });
  await wait(PAST_LONG_PRESS_MS);

  expect(contextMenus).toBe(0);

  view.unmount();
  cleanup();
});
