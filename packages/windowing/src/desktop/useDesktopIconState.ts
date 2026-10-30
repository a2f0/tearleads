import { useCallback, useEffect, useRef, useState } from "react";
import {
  type DesktopIconPosition,
  type DesktopState,
  parseDesktopState,
  serializeDesktopState,
} from "./desktopState";
import type { DesktopStateStorage } from "./desktopStateStorage";

type IconPositions = DesktopState["icons"];

const NO_ICONS: IconPositions = {};

/**
 * The desktop's icon positions, loaded from `storage` and written back after
 * every move. A new adapter (another account's store, say) starts over from
 * what it holds.
 *
 * Moves made before the load finishes win over the stored positions, and are
 * written only once the load has merged them, so an early move never replaces
 * the stored state with a partial one. When the read fails the positions stay
 * in memory and nothing is written, so a passing failure cannot erase a saved
 * layout.
 */
export function useDesktopIconState(storage: DesktopStateStorage) {
  const [icons, setIcons] = useState<IconPositions>(NO_ICONS);
  const iconsRef = useRef<IconPositions>(NO_ICONS);
  const movedRef = useRef(new Set<string>());
  const writableRef = useRef(false);
  const writesRef = useRef<Promise<void>>(Promise.resolve());

  const publish = useCallback((next: IconPositions) => {
    iconsRef.current = next;
    setIcons(next);
  }, []);

  const save = useCallback(
    (next: IconPositions) => {
      const serialized = serializeDesktopState({ icons: next });
      // Writes run one at a time, in order, so the last move is the one kept.
      writesRef.current = writesRef.current
        .then(() => storage.write(serialized))
        .catch(() => {});
    },
    [storage],
  );

  useEffect(() => {
    let current = true;
    movedRef.current = new Set();
    writableRef.current = false;
    publish(NO_ICONS);
    storage.read().then(
      (serialized) => {
        if (!current) {
          return;
        }
        const merged: Record<string, DesktopIconPosition> = {
          ...parseDesktopState(serialized).icons,
        };
        for (const appId of movedRef.current) {
          const position = iconsRef.current[appId];
          if (position) {
            merged[appId] = position;
          }
        }
        writableRef.current = true;
        publish(merged);
        if (movedRef.current.size > 0) {
          save(merged);
        }
      },
      () => {},
    );
    return () => {
      current = false;
    };
  }, [publish, save, storage]);

  const moveIcon = useCallback(
    (appId: string, position: DesktopIconPosition) => {
      movedRef.current.add(appId);
      const next = { ...iconsRef.current, [appId]: position };
      publish(next);
      if (writableRef.current) {
        save(next);
      }
    },
    [publish, save],
  );

  return { icons, moveIcon };
}
