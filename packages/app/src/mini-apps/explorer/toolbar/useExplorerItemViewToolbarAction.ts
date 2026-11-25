import type { MiniAppItemView } from "../../../components/mini-app/item-view/miniAppItemView";
import {
  type MiniAppItemViewSwitchLabels,
  useMiniAppItemViewToolbarAction,
} from "../../../components/mini-app/item-view/useMiniAppItemViewToolbarAction";
import { EXPLORER_LABELS } from "../labels";

const EXPLORER_ITEM_VIEW_SWITCH_LABELS: MiniAppItemViewSwitchLabels = {
  grid: EXPLORER_LABELS.itemViewSwitchToGrid,
  "large-rows": EXPLORER_LABELS.itemViewSwitchToLargeRows,
  rows: EXPLORER_LABELS.itemViewSwitchToRows,
};

// Right of the container's Get Info (100) and left of the hub's Sync entry
// point (50); the toolbar orders highest priority first.
const EXPLORER_ITEM_VIEW_ACTION_PRIORITY = 75;

/** The item list's view switch (see {@link useMiniAppItemViewToolbarAction}). */
export function useExplorerItemViewToolbarAction(params: {
  cycleView: () => void;
  nextView: MiniAppItemView;
  show: boolean;
}) {
  useMiniAppItemViewToolbarAction({
    ...params,
    id: "explorer-item-view",
    labels: EXPLORER_ITEM_VIEW_SWITCH_LABELS,
    priority: EXPLORER_ITEM_VIEW_ACTION_PRIORITY,
  });
}
