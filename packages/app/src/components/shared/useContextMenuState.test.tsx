import { expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import type { MouseEvent } from "react";
import { useContextMenuState } from "./useContextMenuState";

function createContextMenuEvent(position: { x: number; y: number }) {
  let preventDefaultCalls = 0;
  let stopPropagationCalls = 0;
  const event = {
    clientX: position.x,
    clientY: position.y,
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
    useContextMenuState({ onOpen: (id: string) => openedIds.push(id) }),
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
