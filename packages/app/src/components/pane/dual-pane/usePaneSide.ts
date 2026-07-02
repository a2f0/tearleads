import { useContext } from "react";

import { PaneSideContext } from "./context";
import type { PaneSide } from "./types";

export function usePaneSide(): PaneSide {
  const side = useContext(PaneSideContext);
  if (!side) {
    throw new Error("usePaneSide must be used within a PaneSideProvider.");
  }
  return side;
}

// Non-throwing variant for code that runs in BOTH pane policies: the shared
// (regular app) policy mounts its runtime above the workspaces, outside any
// PaneSideProvider, so callers there must tolerate the absence rather than
// crash. Returns null when there is no surrounding PaneSideProvider.
export function usePaneSideOptional(): PaneSide | null {
  return useContext(PaneSideContext);
}
