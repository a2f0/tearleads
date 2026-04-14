import type {
  ComponentType,
  Dispatch,
  MutableRefObject,
  SetStateAction,
} from "react";
import { useCallback } from "react";
import type { WindowEntry } from "./types";
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

export function useWindowStateActions({
  counter,
  setWindows,
}: UseWindowStateActionsParams) {
  const create = useCallback(
    (title: string, x: number, y: number, component?: ComponentType) => {
      const id = String(++counter.current);
      setWindows((previousWindows) => {
        const maxZIndex = previousWindows.reduce(
          (currentMaxZIndex, windowEntry) =>
            Math.max(currentMaxZIndex, windowEntry.zIndex),
          0,
        );
        return [
          ...previousWindows,
          createWindowEntry(id, title, x, y, maxZIndex + 1, component),
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

  return {
    bringToFront,
    close,
    create,
    minimize,
    moveBackward,
    moveForward,
    restore,
    updateTitle,
  };
}
