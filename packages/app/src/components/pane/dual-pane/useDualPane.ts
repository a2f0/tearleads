import { useContext } from "react";

import { DualPaneContext } from "./context";
import type { DualPaneContextValue } from "./types";

export function useDualPane(): DualPaneContextValue {
  const ctx = useContext(DualPaneContext);
  if (!ctx) {
    throw new Error("useDualPane must be used within a DualPaneProvider.");
  }
  return ctx;
}
