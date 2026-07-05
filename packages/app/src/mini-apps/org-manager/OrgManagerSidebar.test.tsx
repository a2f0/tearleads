import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { MouseEvent } from "react";
import {
  useWindowSidebar,
  WindowSidebarProvider,
} from "../../components/window/WindowSidebarContext";
import type { OrgManagerSidebarContextMenuTarget } from "./context-menu/OrgManagerContextMenu";
import type { OrgSwitcherState } from "./hooks/useOrgSwitcher";
import { ORG_MANAGER_LABELS } from "./labels";
import {
  type OrgManagerView,
  useOrgManagerSidebarPanel,
} from "./OrgManagerSidebar";

afterEach(() => cleanup());

function setView(_view: OrgManagerView) {}

function SidebarRegistration({
  enabled,
  handleContextMenu,
  switcher,
}: {
  enabled: boolean;
  handleContextMenu?:
    | ((
        event: MouseEvent<HTMLElement>,
        view: OrgManagerSidebarContextMenuTarget,
      ) => void)
    | undefined;
  switcher?: OrgSwitcherState | undefined;
}) {
  useOrgManagerSidebarPanel({
    enabled,
    handleContextMenu,
    setView,
    switcher,
    view: "directory",
  });

  return null;
}

function SidebarOutput() {
  const { sidebar } = useWindowSidebar();
  return <div>{sidebar}</div>;
}

function SidebarHarness({
  enabled,
  handleContextMenu,
  switcher,
}: {
  enabled: boolean;
  handleContextMenu?:
    | ((
        event: MouseEvent<HTMLElement>,
        view: OrgManagerSidebarContextMenuTarget,
      ) => void)
    | undefined;
  switcher?: OrgSwitcherState | undefined;
}) {
  return (
    <WindowSidebarProvider>
      <SidebarRegistration
        enabled={enabled}
        handleContextMenu={handleContextMenu}
        switcher={switcher}
      />
      <SidebarOutput />
    </WindowSidebarProvider>
  );
}

test("org manager sidebar panel clears itself when disabled", async () => {
  const view = render(<SidebarHarness enabled />);

  await waitFor(() => {
    expect(view.getByText(ORG_MANAGER_LABELS.directory)).toBeTruthy();
    expect(view.getByText(ORG_MANAGER_LABELS.groups)).toBeTruthy();
    expect(view.getByText(ORG_MANAGER_LABELS.grants)).toBeTruthy();
    expect(view.getByText(ORG_MANAGER_LABELS.organization)).toBeTruthy();
    expect(view.getByText(ORG_MANAGER_LABELS.usage)).toBeTruthy();
  });

  view.rerender(<SidebarHarness enabled={false} />);

  await waitFor(() => {
    expect(view.queryByText(ORG_MANAGER_LABELS.directory)).toBeNull();
  });
});

test("org manager sidebar switcher lists organizations and drives selection", async () => {
  const selected: string[] = [];
  let created = 0;
  const switcher: OrgSwitcherState = {
    activeOrganizationId: "org-a",
    createOrganization: async () => {
      created += 1;
    },
    creating: false,
    organizations: [
      { name: "Acme", organizationId: "org-a", rootContainerId: "c-a" },
      { name: null, organizationId: "org-b", rootContainerId: "c-b" },
    ],
    selectOrganization: (organizationId) => {
      selected.push(organizationId);
    },
  };

  const view = render(<SidebarHarness enabled switcher={switcher} />);

  await waitFor(() => {
    expect(view.getByText("Acme")).toBeTruthy();
  });
  expect(view.getByText(ORG_MANAGER_LABELS.unnamedOrganization)).toBeTruthy();
  expect(view.getByText(ORG_MANAGER_LABELS.newOrganizationAction)).toBeTruthy();

  fireEvent.click(view.getByText(ORG_MANAGER_LABELS.unnamedOrganization));
  fireEvent.click(view.getByText(ORG_MANAGER_LABELS.newOrganizationAction));

  expect(selected).toEqual(["org-b"]);
  expect(created).toBe(1);
});

test("org manager sidebar omits the switcher when none is provided", async () => {
  const view = render(<SidebarHarness enabled />);

  await waitFor(() => {
    expect(view.getByText(ORG_MANAGER_LABELS.directory)).toBeTruthy();
  });
  expect(view.queryByText(ORG_MANAGER_LABELS.organizations)).toBeNull();
  expect(view.queryByText(ORG_MANAGER_LABELS.newOrganizationAction)).toBeNull();
});

test("org manager sidebar exposes context menus for roster and groups", async () => {
  const contextMenuTargets: OrgManagerSidebarContextMenuTarget[] = [];
  const view = render(
    <SidebarHarness
      enabled
      handleContextMenu={(_event, target) => {
        contextMenuTargets.push(target);
      }}
    />,
  );

  await waitFor(() => {
    expect(view.getByText(ORG_MANAGER_LABELS.directory)).toBeTruthy();
  });

  fireEvent.contextMenu(view.getByText(ORG_MANAGER_LABELS.directory));
  fireEvent.contextMenu(view.getByText(ORG_MANAGER_LABELS.groups));
  fireEvent.contextMenu(view.getByText(ORG_MANAGER_LABELS.grants));

  expect(contextMenuTargets).toEqual(["directory", "groups"]);
});
