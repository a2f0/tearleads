import { useTouchRowHeight } from "../../../navigation/useTouchRowHeight";
import { useMiniAppCompactTableLayout } from "../tables/MiniAppCompactTable";
import { MINI_APP_ITEM_GRID_ROW_HEIGHT } from "./MiniAppItemGrid";
import {
  getMiniAppItemViewRowHeight,
  type MiniAppItemView,
} from "./miniAppItemView";

/**
 * The one row pitch for an item list in its current view — a table row, or a
 * line of grid tiles — and whether a table row folds into a two-line summary.
 *
 * Three places have to agree on the pitch — the virtual window math (which
 * derives the fetched limit/offset), the spacer padding, and the frame's
 * `--mini-app-virtual-row-height` — or the spacers place the fetched rows away
 * from the scroll offset that requested them, and the viewport shows padding
 * instead of rows. That is why this takes `narrowFrame` as an argument rather
 * than measuring: only the pane that owns the scroll frame can measure it, so
 * it measures once and hands the result down, and the list it draws cannot
 * derive a second, disagreeing answer.
 *
 * `useTouchRowHeight` mirrors the bump `useMiniAppVirtualWindow` already
 * applies internally, so the rendered pitch and the window math also agree on
 * routed tablets (44px), not just on phones (56px) and desktop (36px). It is
 * `Math.max`-based, so it is a no-op at the two-line pitch.
 */
export function useMiniAppItemViewLayout(
  narrowFrame: boolean,
  view: MiniAppItemView,
): {
  compact: boolean;
  rowHeight: number;
} {
  const { compact: tierCompact } = useMiniAppCompactTableLayout();
  const compact = tierCompact || narrowFrame;
  const rowHeight = useTouchRowHeight(
    view === "grid"
      ? MINI_APP_ITEM_GRID_ROW_HEIGHT
      : getMiniAppItemViewRowHeight(view, compact),
  );
  return { compact, rowHeight };
}
