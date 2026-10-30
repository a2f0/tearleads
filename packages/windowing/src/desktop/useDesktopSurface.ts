import { useCallback, useLayoutEffect, useState } from "react";
import type { DesktopIconPosition } from "./desktopState";
import type { DesktopIconSize } from "./useDesktopIconDrag";

interface SurfaceSize {
  height: number;
  width: number;
}

const UNMEASURED: SurfaceSize = { height: 0, width: 0 };

function clampAxis(value: number, extent: number, surface: number): number {
  if (surface <= 0) {
    return Math.max(0, value);
  }
  return Math.max(0, Math.min(value, surface - extent));
}

/**
 * The surface the icons lie on, measured from the icon layer, which fills
 * it, and a clamp that keeps an icon of a given size on it. Before the layer
 * is laid out (a zero size) positions are only kept off negative coordinates.
 */
export function useDesktopSurface(layer: HTMLElement | null) {
  const [surface, setSurface] = useState(UNMEASURED);
  useLayoutEffect(() => {
    if (!layer) {
      return;
    }
    const measure = () =>
      setSurface((current) =>
        current.width === layer.clientWidth &&
        current.height === layer.clientHeight
          ? current
          : { height: layer.clientHeight, width: layer.clientWidth },
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(layer);
    return () => observer.disconnect();
  }, [layer]);

  const clamp = useCallback(
    (position: DesktopIconPosition, size: DesktopIconSize) => ({
      x: clampAxis(position.x, size.width, surface.width),
      y: clampAxis(position.y, size.height, surface.height),
    }),
    [surface.height, surface.width],
  );

  return { clamp, surface };
}
