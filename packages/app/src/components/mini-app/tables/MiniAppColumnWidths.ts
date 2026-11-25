import { useCallback, useMemo, useState } from "react";
import {
  clearStoredPreference,
  loadStoredPreference,
  saveStoredPreference,
} from "../../../utils/storedPreference";
import {
  MINI_APP_COLUMN_MIN_WIDTH,
  type MiniAppColumnWidths,
} from "./miniAppColumnResizeState";

/** What a table needs to draw chosen column widths and to store new ones. */
export interface MiniAppColumnWidthsControl {
  onChange: (widths: MiniAppColumnWidths) => void;
  widths: MiniAppColumnWidths;
}

/** Wider than any column a frame can show; rejects a corrupt stored value. */
const MINI_APP_COLUMN_MAX_STORED_WIDTH = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadMiniAppColumnWidths(storageKey: string): MiniAppColumnWidths {
  return loadStoredPreference(storageKey, (stored) => {
    const parsed: unknown = stored === null ? null : JSON.parse(stored);
    if (!isRecord(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([id, width]) =>
        typeof width === "number" &&
        width >= MINI_APP_COLUMN_MIN_WIDTH &&
        width <= MINI_APP_COLUMN_MAX_STORED_WIDTH
          ? [[id, Math.round(width)]]
          : [],
      ),
    );
  });
}

function saveMiniAppColumnWidths(
  storageKey: string,
  widths: MiniAppColumnWidths,
): void {
  if (Object.keys(widths).length === 0) {
    clearStoredPreference(storageKey);
    return;
  }

  saveStoredPreference(storageKey, JSON.stringify(widths));
}

/**
 * The column widths a reader chose for one table, kept in localStorage as its
 * column visibility is: a display preference of the device, not of an identity
 * or a container. Hand the result to `MiniAppTable` as `columnWidths`.
 */
export function useMiniAppColumnWidths(
  storageKey: string,
): MiniAppColumnWidthsControl {
  const [loaded, setLoaded] = useState(() => ({
    storageKey,
    widths: loadMiniAppColumnWidths(storageKey),
  }));
  // A table handed another key reads that key's widths in the same render,
  // rather than drawing one frame with the previous table's.
  const current =
    loaded.storageKey === storageKey
      ? loaded
      : { storageKey, widths: loadMiniAppColumnWidths(storageKey) };
  if (current !== loaded) {
    setLoaded(current);
  }

  const onChange = useCallback(
    (widths: MiniAppColumnWidths) => {
      setLoaded({ storageKey, widths });
      saveMiniAppColumnWidths(storageKey, widths);
    },
    [storageKey],
  );

  return useMemo(
    () => ({ onChange, widths: current.widths }),
    [current.widths, onChange],
  );
}
