import { type MouseEvent, useMemo } from "react";
import { MiniAppSidebar } from "../../components/shared/MiniAppLayout";
import {
  MiniAppRowButton,
  MiniAppRowText,
} from "../../components/shared/MiniAppRow";
import {
  useRegisteredWindowSidebar,
  useWindowSidebar,
} from "../../components/window/WindowSidebarContext";
import type { OrgManagerContextMenuTarget } from "./context-menu/OrgManagerContextMenu";
import { ORG_MANAGER_LABELS } from "./labels";
import type { OrgManagerView } from "./routes";

export type { OrgManagerView } from "./routes";

type OrgManagerSidebarContextMenuHandler =
  | ((
      event: MouseEvent<HTMLElement>,
      view: OrgManagerContextMenuTarget,
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
      <MiniAppRowButton
        onClick={() => setView("directory")}
        onContextMenu={(event) => handleContextMenu?.(event, "directory")}
        selected={view === "directory"}
      >
        <MiniAppRowText>{ORG_MANAGER_LABELS.directory}</MiniAppRowText>
      </MiniAppRowButton>
      <MiniAppRowButton
        onClick={() => setView("groups")}
        onContextMenu={(event) => handleContextMenu?.(event, "groups")}
        selected={view === "groups"}
      >
        <MiniAppRowText>{ORG_MANAGER_LABELS.groups}</MiniAppRowText>
      </MiniAppRowButton>
      <MiniAppRowButton
        onClick={() => setView("grants")}
        selected={view === "grants"}
      >
        <MiniAppRowText>{ORG_MANAGER_LABELS.grants}</MiniAppRowText>
      </MiniAppRowButton>
      <MiniAppRowButton
        onClick={() => setView("organization")}
        selected={view === "organization"}
      >
        <MiniAppRowText>{ORG_MANAGER_LABELS.organization}</MiniAppRowText>
      </MiniAppRowButton>
      <MiniAppRowButton
        onClick={() => setView("usage")}
        selected={view === "usage"}
      >
        <MiniAppRowText>{ORG_MANAGER_LABELS.usage}</MiniAppRowText>
      </MiniAppRowButton>
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
