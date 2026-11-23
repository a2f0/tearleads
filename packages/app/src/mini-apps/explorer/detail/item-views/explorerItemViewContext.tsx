import { createContext, useContext } from "react";
import {
  type MiniAppItemView,
  useMiniAppItemView,
} from "../../../../components/mini-app/item-view/miniAppItemView";

const EXPLORER_ITEM_VIEW_STORAGE_KEY = "tearleads.explorer:item-view";

/**
 * The item list's view, owned by each Explorer instance: the toolbar switch
 * that cycles it and the container pane that draws it sit far apart in the
 * tree, so the pane reads it from context rather than through every panel in
 * between. A pane rendered without a provider draws the dense rows.
 */
export function useExplorerItemViewState() {
  return useMiniAppItemView(EXPLORER_ITEM_VIEW_STORAGE_KEY);
}

const ExplorerItemViewContext = createContext<MiniAppItemView>("rows");

export const ExplorerItemViewProvider = ExplorerItemViewContext.Provider;

export function useExplorerItemView(): MiniAppItemView {
  return useContext(ExplorerItemViewContext);
}
