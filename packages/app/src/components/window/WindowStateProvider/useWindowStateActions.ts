import type {
  ComponentType,
  Dispatch,
  MutableRefObject,
  SetStateAction,
} from "react";
import { useCallback, useMemo } from "react";
import type {
  WindowCreateOptions,
  WindowEntry,
  WindowStateActions,
} from "./types";
import {
  bringWindowToFront,
  createWindowEntry,
  swapWindowZIndexes,
  updateWindowFlag,
  updateWindowTitle,
} from "./util";

interface UseWindowStateActionsParams {
  counter: MutableRefObject<number>;
  setWindows: Dispatch<SetStateAction<WindowEntry[]>>;
}

function getMaxWindowZIndex(windows: ReadonlyArray<WindowEntry>) {
  return windows.reduce(
    (currentMaxZIndex, windowEntry) =>
      Math.max(currentMaxZIndex, windowEntry.zIndex),
    0,
  );
}

export function useWindowStateActions({
  counter,
  setWindows,
}: UseWindowStateActionsParams) {
  const create = useCallback(
    (
      title: string,
      x: number,
      y: number,
      component?: ComponentType,
      options: WindowCreateOptions = {},
    ) => {
      const id = String(++counter.current);
      setWindows((previousWindows) => {
        const maxZIndex = getMaxWindowZIndex(previousWindows);
        return [
          ...previousWindows,
          createWindowEntry(id, title, x, y, maxZIndex + 1, component, options),
        ];
      });
      return id;
    },
    [counter, setWindows],
  );

  const close = useCallback(
    (id: string) => {
      setWindows((previousWindows) =>
        previousWindows.filter((windowEntry) => windowEntry.id !== id),
      );
    },
    [setWindows],
  );

  const minimize = useCallback(
    (id: string) => {
      setWindows((previousWindows) =>
        updateWindowFlag(previousWindows, id, { minimized: true }),
      );
    },
    [setWindows],
  );

  const restore = useCallback(
    (id: string) => {
      setWindows((previousWindows) =>
        updateWindowFlag(previousWindows, id, { minimized: false }),
      );
    },
    [setWindows],
  );

  const updateTitle = useCallback(
    (id: string, title: string) => {
      setWindows((previousWindows) =>
        updateWindowTitle(previousWindows, id, title),
      );
    },
    [setWindows],
  );

  const moveForward = useCallback(
    (id: string) => {
      setWindows((previousWindows) =>
        swapWindowZIndexes(previousWindows, id, "forward"),
      );
    },
    [setWindows],
  );

  const moveBackward = useCallback(
    (id: string) => {
      setWindows((previousWindows) =>
        swapWindowZIndexes(previousWindows, id, "backward"),
      );
    },
    [setWindows],
  );

  const bringToFront = useCallback(
    (id: string) => {
      setWindows((previousWindows) => bringWindowToFront(previousWindows, id));
    },
    [setWindows],
  );

  return useMemoizedWindowActions({
    bringToFront,
    close,
    create,
    minimize,
    moveBackward,
    moveForward,
    restore,
    updateTitle,
  });
}

function useMemoizedWindowActions(actions: WindowStateActions) {
  const {
    bringToFront,
    close,
    create,
    minimize,
    moveBackward,
    moveForward,
    restore,
    updateTitle,
  } = actions;

  return useMemo(
    () => ({
      bringToFront,
      close,
      create,
      minimize,
      moveBackward,
      moveForward,
      restore,
      updateTitle,
    }),
    [
      bringToFront,
      close,
      create,
      minimize,
      moveBackward,
      moveForward,
      restore,
      updateTitle,
    ],
  );
}
