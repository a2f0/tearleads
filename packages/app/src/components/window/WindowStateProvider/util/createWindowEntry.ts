import type { ComponentType } from "react";
import type { WindowEntry } from "../types";

export function createWindowEntry(
  id: string,
  title: string,
  x: number,
  y: number,
  zIndex: number,
  component?: ComponentType,
): WindowEntry {
  return {
    id,
    title,
    initialX: x,
    initialY: y,
    minimized: false,
    zIndex,
    ...(component ? { component } : {}),
  };
}
