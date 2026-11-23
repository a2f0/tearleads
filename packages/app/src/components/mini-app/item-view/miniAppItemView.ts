import { useCallback, useState } from "react";
import {
  loadStoredPreference,
  saveStoredPreference,
} from "../../../utils/storedPreference";
import { getMiniAppCompactTableRowHeight } from "../tables/MiniAppCompactTable";

/**
 * How a list of items is drawn: the dense table rows every list starts with,
 * the same rows at a taller pitch with a large thumbnail, or a grid of square
 * tiles. A surface offers the subset it supports (the Blob Browser offers the
 * two row sizes; the Explorer item list offers all three) and cycles through
 * them in this order.
 */
export type MiniAppItemView = "rows" | "large-rows" | "grid";

export const MINI_APP_ITEM_VIEWS: ReadonlyArray<MiniAppItemView> = [
  "rows",
  "large-rows",
  "grid",
];

/**
 * The pitch of a large row. Keep in sync with the 80px thumbnail the
 * `[data-item-view="large-rows"]` rules in MiniAppItemView.css size into it:
 * the row is that square plus the cell's block padding and bottom border.
 */
export const MINI_APP_LARGE_ROW_HEIGHT = 96;

function isMiniAppItemView(
  value: string | null,
  views: ReadonlyArray<MiniAppItemView>,
): value is MiniAppItemView {
  return views.some((view) => view === value);
}

/** The view after `view` in `views`, wrapping to the first. */
export function getNextMiniAppItemView(
  view: MiniAppItemView,
  views: ReadonlyArray<MiniAppItemView> = MINI_APP_ITEM_VIEWS,
): MiniAppItemView {
  const index = views.indexOf(view);
  return views[(index + 1) % views.length] ?? view;
}

/**
 * The row pitch for a table drawn in one of the row views. `compact` is the
 * folded two-line layout, which only the dense rows distinguish: a large row
 * is already tall enough for both lines.
 */
export function getMiniAppItemViewRowHeight(
  view: Exclude<MiniAppItemView, "grid">,
  compact: boolean,
): number {
  return view === "large-rows"
    ? MINI_APP_LARGE_ROW_HEIGHT
    : getMiniAppCompactTableRowHeight(compact);
}

export function loadMiniAppItemView(
  storageKey: string,
  views: ReadonlyArray<MiniAppItemView> = MINI_APP_ITEM_VIEWS,
): MiniAppItemView {
  return loadStoredPreference(storageKey, (stored) =>
    isMiniAppItemView(stored, views) ? stored : "rows",
  );
}

/**
 * A surface's chosen view, persisted under `storageKey` as a display
 * preference (not per-identity data). `cycleView` moves to the next offered
 * view, the way the theme switch moves to the next theme.
 */
export function useMiniAppItemView(
  storageKey: string,
  views: ReadonlyArray<MiniAppItemView> = MINI_APP_ITEM_VIEWS,
): {
  cycleView: () => void;
  nextView: MiniAppItemView;
  view: MiniAppItemView;
} {
  const [view, setView] = useState(() =>
    loadMiniAppItemView(storageKey, views),
  );
  const nextView = getNextMiniAppItemView(view, views);
  const cycleView = useCallback(() => {
    setView(nextView);
    saveStoredPreference(storageKey, nextView);
  }, [nextView, storageKey]);

  return { cycleView, nextView, view };
}
