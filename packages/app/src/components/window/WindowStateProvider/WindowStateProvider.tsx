import { type PropsWithChildren, useMemo, useRef, useState } from "react";
import { WindowActionsContext, WindowStateContext } from "./context";
import type { WindowEntry, WindowStateData } from "./types";
import { useWindowStateActions } from "./useWindowStateActions";

export function WindowStateProvider({ children }: PropsWithChildren) {
  const [windows, setWindows] = useState<WindowEntry[]>([]);
  const counter = useRef(0);
  const actions = useWindowStateActions({ counter, setWindows });
  const windowMap = useMemo(
    () => new Map(windows.map((windowEntry) => [windowEntry.id, windowEntry])),
    [windows],
  );
  const state = useMemo<WindowStateData>(
    () => ({
      windows,
      windowMap,
    }),
    [windows, windowMap],
  );
  return (
    <WindowActionsContext.Provider value={actions}>
      <WindowStateContext.Provider value={state}>
        {children}
      </WindowStateContext.Provider>
    </WindowActionsContext.Provider>
  );
}
