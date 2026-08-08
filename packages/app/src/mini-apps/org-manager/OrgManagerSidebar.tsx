import type { MouseEvent } from "react";
import { useMiniAppSectionSidebarPanel } from "../../components/mini-app/MiniAppSectionNavigation";
import type { OrgManagerSidebarContextMenuTarget } from "./context-menu/OrgManagerContextMenu";
import type { OrgManagerView } from "./routes";
import { ORG_MANAGER_SECTIONS } from "./sections";

export type { OrgManagerView } from "./routes";

type OrgManagerSidebarContextMenuHandler =
  | ((
      event: MouseEvent<HTMLElement>,
      view: OrgManagerSidebarContextMenuTarget,
    ) => void)
  | undefined;

export function useOrgManagerSidebarPanel({
  enabled = true,
  handleContextMenu,
  setView,
  view,
}: {
  enabled?: boolean;
  handleContextMenu?: OrgManagerSidebarContextMenuHandler;
  setView: (view: OrgManagerView) => void;
  view: OrgManagerView;
}) {
  useMiniAppSectionSidebarPanel({
    enabled,
    onContextMenu: handleContextMenu,
    sections: ORG_MANAGER_SECTIONS,
    selectedView: view,
    setView,
  });
}
