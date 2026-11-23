import { useWindowTitleBarAction } from "@tearleads/windowing";
import { MINI_APP_ITEM_VIEW_ICONS } from "../../../components/mini-app/item-view/MiniAppItemViewIcons";
import type { MiniAppItemView } from "../../../components/mini-app/item-view/miniAppItemView";
import { EXPLORER_LABELS } from "../labels";

const EXPLORER_ITEM_VIEW_SWITCH_LABELS: Readonly<
  Record<MiniAppItemView, string>
> = {
  grid: EXPLORER_LABELS.itemViewSwitchToGrid,
  "large-rows": EXPLORER_LABELS.itemViewSwitchToLargeRows,
  rows: EXPLORER_LABELS.itemViewSwitchToRows,
};

// Right of the container's Get Info (100) and left of the hub's Sync entry
// point (50); the toolbar orders highest priority first.
const EXPLORER_ITEM_VIEW_ACTION_PRIORITY = 75;

/**
 * The item list's view switch: one button that moves to the next view on each
 * click, showing and naming the view it moves to, the way the theme switch
 * does for themes.
 */
export function useExplorerItemViewToolbarAction(params: {
  cycleView: () => void;
  nextView: MiniAppItemView;
  show: boolean;
}) {
  const { cycleView, nextView, show } = params;
  useWindowTitleBarAction(
    show
      ? {
          icon: MINI_APP_ITEM_VIEW_ICONS[nextView],
          id: "explorer-item-view",
          label: EXPLORER_ITEM_VIEW_SWITCH_LABELS[nextView],
          onClick: cycleView,
          priority: EXPLORER_ITEM_VIEW_ACTION_PRIORITY,
        }
      : null,
  );
}
