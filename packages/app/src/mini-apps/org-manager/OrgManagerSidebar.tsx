import { type MouseEvent, useMemo } from "react";
import {
  MiniAppSectionHeading,
  MiniAppSidebar,
} from "../../components/shared/MiniAppLayout";
import {
  MiniAppRowButton,
  MiniAppRowText,
} from "../../components/shared/MiniAppRow";
import {
  useRegisteredWindowSidebar,
  useWindowSidebar,
} from "../../components/window/WindowSidebarContext";
import type { OrgManagerSidebarContextMenuTarget } from "./context-menu/OrgManagerContextMenu";
import type { OrgSwitcherState } from "./hooks/useOrgSwitcher";
import { ORG_MANAGER_LABELS } from "./labels";
import type { OrgManagerView } from "./routes";

export type { OrgManagerView } from "./routes";

type OrgManagerSidebarContextMenuHandler =
  | ((
      event: MouseEvent<HTMLElement>,
      view: OrgManagerSidebarContextMenuTarget,
    ) => void)
  | undefined;

function OrgManagerSwitcherSection({
  switcher,
}: {
  switcher: OrgSwitcherState;
}) {
  return (
    <>
      <MiniAppSectionHeading>
        {ORG_MANAGER_LABELS.organizations}
      </MiniAppSectionHeading>
      {switcher.organizations.map((organization) => (
        <MiniAppRowButton
          key={organization.organizationId}
          onClick={() =>
            switcher.selectOrganization(organization.organizationId)
          }
          selected={
            organization.organizationId === switcher.activeOrganizationId
          }
        >
          <MiniAppRowText>
            {organization.name ?? ORG_MANAGER_LABELS.unnamedOrganization}
          </MiniAppRowText>
        </MiniAppRowButton>
      ))}
      <MiniAppRowButton
        disabled={switcher.creating}
        onClick={switcher.openCreateOrganizationDialog}
      >
        <MiniAppRowText>
          {switcher.creating
            ? ORG_MANAGER_LABELS.creatingOrganization
            : ORG_MANAGER_LABELS.newOrganizationAction}
        </MiniAppRowText>
      </MiniAppRowButton>
    </>
  );
}

function OrgManagerSidebar({
  handleContextMenu,
  setView,
  switcher,
  view,
}: {
  handleContextMenu?: OrgManagerSidebarContextMenuHandler;
  setView: (view: OrgManagerView) => void;
  switcher?: OrgSwitcherState | undefined;
  view: OrgManagerView;
}) {
  return (
    <MiniAppSidebar>
      {switcher ? <OrgManagerSwitcherSection switcher={switcher} /> : null}
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
      <MiniAppRowButton
        onClick={() => setView("billing")}
        selected={view === "billing"}
      >
        <MiniAppRowText>{ORG_MANAGER_LABELS.billing}</MiniAppRowText>
      </MiniAppRowButton>
    </MiniAppSidebar>
  );
}

export function useOrgManagerSidebarPanel({
  enabled = true,
  handleContextMenu,
  setView,
  switcher,
  view,
}: {
  enabled?: boolean;
  handleContextMenu?: OrgManagerSidebarContextMenuHandler;
  setView: (view: OrgManagerView) => void;
  switcher?: OrgSwitcherState | undefined;
  view: OrgManagerView;
}) {
  const { setSidebar } = useWindowSidebar();
  const sidebar = useMemo(
    () => (
      <OrgManagerSidebar
        handleContextMenu={handleContextMenu}
        setView={setView}
        switcher={switcher}
        view={view}
      />
    ),
    [handleContextMenu, setView, switcher, view],
  );

  useRegisteredWindowSidebar({ enabled, setSidebar, sidebar });
}
