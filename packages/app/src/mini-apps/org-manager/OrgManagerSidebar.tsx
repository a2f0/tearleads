import { type MouseEvent, useMemo } from "react";
import { MiniAppSidebar } from "../../components/mini-app/MiniAppLayout";
import {
  MiniAppRowButton,
  MiniAppRowText,
} from "../../components/mini-app/rows/MiniAppRow";
import {
  useRegisteredWindowSidebar,
  useWindowSidebar,
} from "../../components/window/WindowSidebarContext";
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

function OrgManagerSidebar({
  handleContextMenu,
  setView,
  view,
}: {
  handleContextMenu?: OrgManagerSidebarContextMenuHandler;
  setView: (view: OrgManagerView) => void;
  view: OrgManagerView;
}) {
  return (
    <MiniAppSidebar>
      {ORG_MANAGER_SECTIONS.map(
        ({
          contextMenuTarget,
          icon: SectionIcon,
          label,
          view: sectionView,
        }) => (
          <MiniAppRowButton
            key={sectionView}
            onClick={() => setView(sectionView)}
            onContextMenu={
              contextMenuTarget
                ? (event) => handleContextMenu?.(event, contextMenuTarget)
                : undefined
            }
            selected={view === sectionView}
          >
            <SectionIcon
              aria-hidden
              className="org-manager-sidebar-icon"
              size={20}
            />
            <MiniAppRowText>{label}</MiniAppRowText>
          </MiniAppRowButton>
        ),
      )}
    </MiniAppSidebar>
  );
}

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
  const { setSidebar } = useWindowSidebar();
  const sidebar = useMemo(
    () => (
      <OrgManagerSidebar
        handleContextMenu={handleContextMenu}
        setView={setView}
        view={view}
      />
    ),
    [handleContextMenu, setView, view],
  );

  useRegisteredWindowSidebar({ enabled, setSidebar, sidebar });
}
