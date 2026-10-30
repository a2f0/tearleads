import { useCallback, useLayoutEffect, useState } from "react";
import {
  clampDesktopIconPosition,
  type DesktopIconPosition,
  type DesktopSurfaceSize,
} from "./desktopState";

const UNMEASURED: DesktopSurfaceSize = { height: 0, width: 0 };

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
    (position: DesktopIconPosition, size: DesktopSurfaceSize) =>
      clampDesktopIconPosition(position, size, surface),
    [surface],
  );

  return { clamp, surface };
}
