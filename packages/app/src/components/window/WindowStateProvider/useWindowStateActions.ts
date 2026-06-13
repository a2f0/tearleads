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

function arePathSegmentsEqual(
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
) {
  return (
    left.length === right.length &&
    left.every((segment, index) => segment === right[index])
  );
}

function useUpdateMiniAppRouteAction(
  setWindows: Dispatch<SetStateAction<WindowEntry[]>>,
) {
  return useCallback(
    (id: string, pathSegments: ReadonlyArray<string>) => {
      setWindows((previousWindows) => {
        const targetWindow = previousWindows.find(
          (windowEntry) => windowEntry.id === id,
        );
        if (!targetWindow) {
          return previousWindows;
        }

        if (
          arePathSegmentsEqual(
            targetWindow.miniAppPathSegments ?? [],
            pathSegments,
          )
        ) {
          return previousWindows;
        }

        return previousWindows.map((windowEntry) =>
          windowEntry.id === id
            ? { ...windowEntry, miniAppPathSegments: [...pathSegments] }
            : windowEntry,
        );
      });
    },
    [setWindows],
  );
}

function useCloseWindowAction(
  setWindows: Dispatch<SetStateAction<WindowEntry[]>>,
) {
  return useCallback(
    (id: string) => {
      setWindows((previousWindows) =>
        previousWindows.filter((windowEntry) => windowEntry.id !== id),
      );
    },
    [setWindows],
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

  const close = useCloseWindowAction(setWindows);

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
      setWindows((previousWindows) => {
        const frontWindows = bringWindowToFront(previousWindows, id);
        return updateWindowFlag(frontWindows, id, { minimized: false });
      });
    },
    [setWindows],
  );

  const updateMiniAppRoute = useUpdateMiniAppRouteAction(setWindows);

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
    updateMiniAppRoute,
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
    updateMiniAppRoute,
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
      updateMiniAppRoute,
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
      updateMiniAppRoute,
      updateTitle,
    ],
  );
}
