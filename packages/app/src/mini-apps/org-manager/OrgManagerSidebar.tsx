import { useMemo } from "react";
import {
  MiniAppRowButton,
  MiniAppRowText,
} from "../../components/shared/MiniAppRow";
import {
  useRegisteredWindowSidebar,
  useWindowSidebar,
} from "../../components/window/WindowSidebarContext";
import { ORG_MANAGER_LABELS } from "./labels";
import type { OrgManagerView } from "./routes";

export type { OrgManagerView } from "./routes";

function OrgManagerSidebar({
  setView,
  view,
}: {
  setView: (view: OrgManagerView) => void;
  view: OrgManagerView;
}) {
  return (
    <div className="org-manager-sidebar">
      <MiniAppRowButton
        className="org-manager-nav"
        onClick={() => setView("directory")}
        selected={view === "directory"}
      >
        <MiniAppRowText>{ORG_MANAGER_LABELS.directory}</MiniAppRowText>
      </MiniAppRowButton>
      <MiniAppRowButton
        className="org-manager-nav"
        onClick={() => setView("groups")}
        selected={view === "groups"}
      >
        <MiniAppRowText>{ORG_MANAGER_LABELS.groups}</MiniAppRowText>
      </MiniAppRowButton>
      <MiniAppRowButton
        className="org-manager-nav"
        onClick={() => setView("grants")}
        selected={view === "grants"}
      >
        <MiniAppRowText>{ORG_MANAGER_LABELS.grants}</MiniAppRowText>
      </MiniAppRowButton>
      <MiniAppRowButton
        className="org-manager-nav"
        onClick={() => setView("usage")}
        selected={view === "usage"}
      >
        <MiniAppRowText>{ORG_MANAGER_LABELS.usage}</MiniAppRowText>
      </MiniAppRowButton>
    </div>
  );
}

export function useOrgManagerSidebarPanel({
  enabled = true,
  setView,
  view,
}: {
  enabled?: boolean;
  setView: (view: OrgManagerView) => void;
  view: OrgManagerView;
}) {
  const { setSidebar } = useWindowSidebar();
  const sidebar = useMemo(
    () => <OrgManagerSidebar setView={setView} view={view} />,
    [setView, view],
  );

  useRegisteredWindowSidebar({ enabled, setSidebar, sidebar });
}
