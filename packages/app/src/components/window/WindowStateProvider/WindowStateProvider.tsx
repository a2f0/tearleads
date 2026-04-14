import { type PropsWithChildren, useMemo, useRef, useState } from "react";
import { WindowStateContext } from "./context";
import type { WindowEntry } from "./types";
import { useWindowStateActions } from "./useWindowStateActions";

export function WindowStateProvider({ children }: PropsWithChildren) {
  const [windows, setWindows] = useState<WindowEntry[]>([]);
  const counter = useRef(0);
  const {
    bringToFront,
    close,
    create,
    minimize,
    moveBackward,
    moveForward,
    restore,
    updateTitle,
  } = useWindowStateActions({ counter, setWindows });
  const windowMap = useMemo(
    () => new Map(windows.map((windowEntry) => [windowEntry.id, windowEntry])),
    [windows],
  );
  const value = useMemo(
    () => ({
      windows,
      windowMap,
      create,
      close,
      minimize,
      restore,
      updateTitle,
      moveForward,
      moveBackward,
      bringToFront,
    }),
    [
      windows,
      windowMap,
      create,
      close,
      minimize,
      restore,
      updateTitle,
      moveForward,
      moveBackward,
      bringToFront,
    ],
  );
  return (
    <WindowStateContext.Provider value={value}>
      {children}
    </WindowStateContext.Provider>
  );
}
