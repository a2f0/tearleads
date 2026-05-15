import { useEffect, useMemo } from "react";
import {
  MiniAppRowButton,
  MiniAppRowText,
} from "../../components/shared/MiniAppRow";
import { useWindowSidebar } from "../../components/window/WindowSidebarContext";
import { ORG_MANAGER_LABELS } from "./labels";

export type OrgManagerView = "directory" | "groups";

function OrgManagerSidebar({
  loading,
  mutating,
  refreshDirectoryAndGroups,
  setView,
  view,
}: {
  loading: boolean;
  mutating: boolean;
  refreshDirectoryAndGroups: () => Promise<void>;
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
        disabled={loading || mutating}
        onClick={() => void refreshDirectoryAndGroups()}
      >
        <MiniAppRowText>{ORG_MANAGER_LABELS.refresh}</MiniAppRowText>
      </MiniAppRowButton>
    </div>
  );
}

export function useOrgManagerSidebarPanel({
  enabled = true,
  loading,
  mutating,
  refreshDirectoryAndGroups,
  setView,
  view,
}: {
  enabled?: boolean;
  loading: boolean;
  mutating: boolean;
  refreshDirectoryAndGroups: () => Promise<void>;
  setView: (view: OrgManagerView) => void;
  view: OrgManagerView;
}) {
  const { setSidebar } = useWindowSidebar();
  const sidebar = useMemo(
    () => (
      <OrgManagerSidebar
        loading={loading}
        mutating={mutating}
        refreshDirectoryAndGroups={refreshDirectoryAndGroups}
        setView={setView}
        view={view}
      />
    ),
    [loading, mutating, refreshDirectoryAndGroups, setView, view],
  );

  useEffect(() => {
    setSidebar(enabled ? sidebar : null);
    return () => setSidebar(null);
  }, [enabled, setSidebar, sidebar]);
}
