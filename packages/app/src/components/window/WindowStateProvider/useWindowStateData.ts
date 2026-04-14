import { useContext } from "react";
import { WindowStateContext } from "./context";

export function useWindowStateData() {
  const ctx = useContext(WindowStateContext);
  if (!ctx) {
    throw new Error("useWindowStateData requires WindowStateProvider");
  }
  return ctx;
}
