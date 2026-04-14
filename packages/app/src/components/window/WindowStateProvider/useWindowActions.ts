import { useContext } from "react";
import { WindowActionsContext } from "./context";

export function useWindowActions() {
  const ctx = useContext(WindowActionsContext);
  if (!ctx) {
    throw new Error("useWindowActions requires WindowStateProvider");
  }
  return ctx;
}
