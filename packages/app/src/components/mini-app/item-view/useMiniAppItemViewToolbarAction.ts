import { useWindowTitleBarAction } from "@tearleads/windowing";
import { MINI_APP_ITEM_VIEW_ICONS } from "./MiniAppItemViewIcons";
import type { MiniAppItemView } from "./miniAppItemView";

/** What the switch is called when a click moves to each view. */
export type MiniAppItemViewSwitchLabels = Readonly<
  Record<MiniAppItemView, string>
>;

/**
 * A list's view switch on the window toolbar: one button that moves to the
 * next view on each click, showing and naming the view it moves to, the way
 * the theme switch does for themes. Each surface brings its own id, labels,
 * and place in the toolbar's order.
 */
export function useMiniAppItemViewToolbarAction(params: {
  cycleView: () => void;
  id: string;
  labels: MiniAppItemViewSwitchLabels;
  nextView: MiniAppItemView;
  priority: number;
  show: boolean;
}) {
  const { cycleView, id, labels, nextView, priority, show } = params;
  useWindowTitleBarAction(
    show
      ? {
          icon: MINI_APP_ITEM_VIEW_ICONS[nextView],
          id,
          label: labels[nextView],
          onClick: cycleView,
          priority,
        }
      : null,
  );
}
