import type {
  ComponentType,
  Dispatch,
  MutableRefObject,
  SetStateAction,
} from "react";
import { useCallback, useMemo } from "react";
import type { WindowCreateOptions, WindowEntry } from "./types";
import {
  bringWindowToFront,
  createWindowEntry,
  getMaxWindowZIndex,
  swapWindowZIndexes,
  updateWindowFlag,
} from "./util";

interface UseWindowStateActionsParams {
  counter: MutableRefObject<number>;
  setWindows: Dispatch<SetStateAction<WindowEntry[]>>;
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
    (
      id: string,
      pathSegments: ReadonlyArray<string>,
      options: { replace?: boolean | undefined } = {},
    ) => {
      setWindows((previousWindows) => {
        const targetWindow = previousWindows.find(
          (windowEntry) => windowEntry.id === id,
        );
        if (!targetWindow) {
          return previousWindows;
        }

        const currentPathSegments = targetWindow.miniAppPathSegments ?? [];
        if (arePathSegmentsEqual(currentPathSegments, pathSegments)) {
          return previousWindows;
        }

        // A replacing navigation swaps the current entry rather than stacking on
        // it — the transient step it replaces (a type picker, an unavailable
        // route corrected to the default) must not become a Back destination.
        const nextHistory = options.replace
          ? (targetWindow.miniAppRouteHistory ?? [])
          : [...(targetWindow.miniAppRouteHistory ?? []), currentPathSegments];

        return previousWindows.map((windowEntry) =>
          windowEntry.id === id
            ? {
                ...windowEntry,
                miniAppPathSegments: [...pathSegments],
                miniAppRouteHistory: nextHistory,
              }
            : windowEntry,
        );
      });
    },
    [setWindows],
  );
}

function useGoBackMiniAppRouteAction(
  setWindows: Dispatch<SetStateAction<WindowEntry[]>>,
) {
  return useCallback(
    (id: string) => {
      setWindows((previousWindows) => {
        const targetWindow = previousWindows.find(
          (windowEntry) => windowEntry.id === id,
        );
        const history = targetWindow?.miniAppRouteHistory ?? [];
        const previousPathSegments = history[history.length - 1];
        if (!targetWindow || previousPathSegments === undefined) {
          return previousWindows;
        }

        return previousWindows.map((windowEntry) =>
          windowEntry.id === id
            ? {
                ...windowEntry,
                miniAppPathSegments: [...previousPathSegments],
                miniAppRouteHistory: history.slice(0, -1),
              }
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

function useWindowMaximizeActions(
  setWindows: Dispatch<SetStateAction<WindowEntry[]>>,
) {
  // Maximizing always reveals the window, so it un-minimizes and raises in one
  // step — the taskbar can offer "Maximize" on a minimized window directly.
  const maximize = useCallback(
    (id: string) => {
      setWindows((previousWindows) =>
        updateWindowFlag(bringWindowToFront(previousWindows, id), id, {
          maximized: true,
          minimized: false,
        }),
      );
    },
    [setWindows],
  );

  const toggleMaximize = useCallback(
    (id: string) => {
      setWindows((previousWindows) => {
        const target = previousWindows.find(
          (windowEntry) => windowEntry.id === id,
        );
        if (!target) {
          return previousWindows;
        }

        const maximized = !target.maximized;
        return updateWindowFlag(
          maximized ? bringWindowToFront(previousWindows, id) : previousWindows,
          id,
          { maximized },
        );
      });
    },
    [setWindows],
  );

  return { maximize, toggleMaximize };
}

function useWindowZOrderActions(
  setWindows: Dispatch<SetStateAction<WindowEntry[]>>,
) {
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

  return { bringToFront, moveBackward, moveForward };
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

  const { maximize, toggleMaximize } = useWindowMaximizeActions(setWindows);

  const updateMiniAppRoute = useUpdateMiniAppRouteAction(setWindows);
  const goBackMiniAppRoute = useGoBackMiniAppRouteAction(setWindows);

  const updateTitle = useCallback(
    (id: string, title: string) => {
      setWindows((previousWindows) =>
        updateWindowFlag(previousWindows, id, { title }),
      );
    },
    [setWindows],
  );

  const { bringToFront, moveBackward, moveForward } =
    useWindowZOrderActions(setWindows);

  return useMemo(
    () => ({
      bringToFront,
      close,
      create,
      goBackMiniAppRoute,
      maximize,
      minimize,
      moveBackward,
      moveForward,
      restore,
      toggleMaximize,
      updateMiniAppRoute,
      updateTitle,
    }),
    [
      bringToFront,
      close,
      create,
      goBackMiniAppRoute,
      maximize,
      minimize,
      moveBackward,
      moveForward,
      restore,
      toggleMaximize,
      updateMiniAppRoute,
      updateTitle,
    ],
  );
}
