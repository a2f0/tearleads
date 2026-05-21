import { useMemo } from "react";
import { MiniAppSidebar } from "../../components/shared/MiniAppLayout";
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
    <MiniAppSidebar>
      <MiniAppRowButton
        onClick={() => setView("directory")}
        selected={view === "directory"}
      >
        <MiniAppRowText>{ORG_MANAGER_LABELS.directory}</MiniAppRowText>
      </MiniAppRowButton>
      <MiniAppRowButton
        onClick={() => setView("groups")}
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
