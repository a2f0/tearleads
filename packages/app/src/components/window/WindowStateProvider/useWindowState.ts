import { useContext } from "react";
import { WindowStateContext } from "./context";

export function useWindowState() {
  const ctx = useContext(WindowStateContext);
  if (!ctx) {
    throw new Error("useWindowState requires WindowStateProvider");
  }
  return ctx;
}
