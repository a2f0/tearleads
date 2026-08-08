import { expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import type { MouseEvent } from "react";
import {
  useContextMenuPositionState,
  useContextMenuState,
} from "./useContextMenuState";

function createContextMenuEvent(
  position: { x: number; y: number },
  triggerBox?: { bottom: number; left: number },
) {
  let preventDefaultCalls = 0;
  let stopPropagationCalls = 0;
  const event = {
    clientX: position.x,
    clientY: position.y,
    currentTarget: {
      getBoundingClientRect: () => triggerBox ?? { bottom: 0, left: 0 },
    },
    preventDefault: () => {
      preventDefaultCalls += 1;
    },
    stopPropagation: () => {
      stopPropagationCalls += 1;
    },
  } as unknown as MouseEvent<HTMLElement>;

  return {
    event,
    getPreventDefaultCalls: () => preventDefaultCalls,
    getStopPropagationCalls: () => stopPropagationCalls,
  };
}

test("context menu state opens from mouse position and closes", () => {
  const openedIds: string[] = [];
  const view = renderHook(() =>
    useContextMenuState<string>({ onOpen: (id) => openedIds.push(id) }),
  );
  const contextMenuEvent = createContextMenuEvent({ x: 12, y: 34 });

  act(() => {
    view.result.current.openContextMenu(contextMenuEvent.event, "item-1");
  });

  expect(contextMenuEvent.getPreventDefaultCalls()).toBe(1);
  expect(contextMenuEvent.getStopPropagationCalls()).toBe(1);
  expect(openedIds).toEqual(["item-1"]);
  expect(view.result.current.contextMenu).toEqual({
    id: "item-1",
    position: { x: 12, y: 34 },
  });

  act(() => {
    view.result.current.closeContextMenu();
  });

  expect(view.result.current.contextMenu).toBeNull();
});

// Enter/Space on a kebab dispatches a click reporting 0,0 — the pointer position
// a menu is normally placed at would put it in the viewport's top-left corner,
// nowhere near the control the user activated. Fall back to the trigger's box.
test("keyboard activation opens the menu under its trigger, not at 0,0", () => {
  const view = renderHook(() => useContextMenuState<string>());
  const keyboardEvent = createContextMenuEvent(
    { x: 0, y: 0 },
    { bottom: 96, left: 40 },
  );

  act(() => {
    view.result.current.openContextMenu(keyboardEvent.event, "item-1");
  });

  expect(view.result.current.contextMenu).toEqual({
    id: "item-1",
    position: { x: 40, y: 96 },
  });
});

test("targetless context menu state opens at an explicit position", () => {
  const view = renderHook(() => useContextMenuPositionState());

  act(() => {
    view.result.current.openContextMenuAt({ x: 8, y: 13 });
  });

  expect(view.result.current.contextMenu).toEqual({ x: 8, y: 13 });
});
