import { useCallback, useEffect, useState } from "react";
import type { DesktopIconStep } from "./DesktopIcon";

/**
 * Which icon is selected. A press anywhere but an icon clears it, and steps
 * move it (and focus) along the icons' order. One icon is tabbable: the
 * selected one, or else the first.
 */
export function useDesktopIconSelection<AppId extends string>(
  layer: HTMLElement | null,
  appIds: ReadonlyArray<AppId>,
) {
  const [selected, setSelected] = useState<AppId | null>(null);

  useEffect(() => {
    if (!layer || selected === null) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        layer.contains(target) &&
        target.closest(".desktop-icon")
      ) {
        return;
      }
      setSelected(null);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [layer, selected]);

  const step = useCallback(
    (from: AppId, direction: DesktopIconStep) => {
      const index = appIds.indexOf(from);
      const last = appIds.length - 1;
      const target = {
        first: 0,
        last,
        next: Math.min(index + 1, last),
        previous: Math.max(index - 1, 0),
      }[direction];
      const appId = appIds[target];
      if (appId === undefined) {
        return;
      }
      setSelected(appId);
      layer
        ?.querySelector<HTMLElement>(`[data-app-id="${CSS.escape(appId)}"]`)
        ?.focus();
    },
    [appIds, layer],
  );

  const tabbableId =
    selected !== null && appIds.includes(selected) ? selected : appIds[0];

  return { selected, setSelected, step, tabbableId };
}
