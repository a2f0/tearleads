import { createContext } from "react";
import type { WindowStateActions, WindowStateData } from "./types";

// Keep state and actions in separate contexts so consumers that only need
// stable actions like create/restore do not re-render on every window-state
// change.
export const WindowStateContext = createContext<WindowStateData | null>(null);

export const WindowActionsContext = createContext<WindowStateActions | null>(
  null,
);
