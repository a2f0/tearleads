import { createContext } from "react";

import type { DualPaneContextValue, PaneSide } from "./types";

export const DualPaneContext = createContext<DualPaneContextValue | null>(null);
export const PaneSideContext = createContext<PaneSide | null>(null);
