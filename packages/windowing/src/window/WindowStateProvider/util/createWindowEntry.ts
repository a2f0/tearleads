import type { ComponentType } from "react";
import type { WindowCreateOptions, WindowEntry } from "../types";

export function createWindowEntry(
  id: string,
  title: string,
  x: number,
  y: number,
  zIndex: number,
  component?: ComponentType,
  options: WindowCreateOptions = {},
): WindowEntry {
  return {
    id,
    ...(options.appId ? { appId: options.appId } : {}),
    initialShowSidebar: options.initialShowSidebar,
    ...(options.pathSegments
      ? { pathSegments: [...options.pathSegments] }
      : {}),
    title,
    initialX: x,
    initialY: y,
    ...(options.position ? { position: { ...options.position } } : {}),
    ...(options.size ? { size: { ...options.size } } : {}),
    ...(options.fitToContent ? { fitToContent: true } : {}),
    maximized: false,
    minimized: false,
    zIndex,
    ...(component ? { component } : {}),
  };
}
