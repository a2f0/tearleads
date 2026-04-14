import { createContext } from "react";
import type { WindowStateActions, WindowStateData } from "./types";

export const WindowStateContext = createContext<WindowStateData | null>(null);

export const WindowActionsContext = createContext<WindowStateActions | null>(
  null,
);
