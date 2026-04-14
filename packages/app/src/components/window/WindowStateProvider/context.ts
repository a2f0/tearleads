import { createContext } from "react";
import type { WindowStateContextValue } from "./types";

export const WindowStateContext = createContext<WindowStateContextValue | null>(
  null,
);
