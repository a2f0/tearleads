import { ListIcon } from "@phosphor-icons/react/dist/csr/List";
import { RowsIcon } from "@phosphor-icons/react/dist/csr/Rows";
import { SquaresFourIcon } from "@phosphor-icons/react/dist/csr/SquaresFour";
import type { ReactElement } from "react";
import type { MiniAppItemView } from "./miniAppItemView";

// Module-level elements: the window title-bar registry compares a registered
// action field by field with Object.is, so a stable icon keeps an unchanged
// view switch from re-registering on every render.
export const MINI_APP_ITEM_VIEW_ICONS: Readonly<
  Record<MiniAppItemView, ReactElement>
> = {
  grid: <SquaresFourIcon aria-hidden size={18} />,
  "large-rows": <RowsIcon aria-hidden size={18} />,
  rows: <ListIcon aria-hidden size={18} />,
};
