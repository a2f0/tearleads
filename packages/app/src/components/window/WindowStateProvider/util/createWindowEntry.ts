import type { ComponentType } from "react";
import type { WindowEntry } from "../types";

export function createWindowEntry(
  id: string,
  title: string,
  x: number,
  y: number,
  zIndex: number,
  component?: ComponentType,
  options: { appId?: string } = {},
): WindowEntry {
  return {
    id,
    ...(options.appId ? { appId: options.appId } : {}),
    title,
    initialX: x,
    initialY: y,
    minimized: false,
    zIndex,
    ...(component ? { component } : {}),
  };
}
