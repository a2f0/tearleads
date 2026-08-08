import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { MouseEvent } from "react";
import {
  useWindowSidebar,
  WindowSidebarProvider,
} from "../../components/window/WindowSidebarContext";
import type { OrgManagerSidebarContextMenuTarget } from "./context-menu/OrgManagerContextMenu";
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
}: {
  enabled: boolean;
  handleContextMenu?:
    | ((
        event: MouseEvent<HTMLElement>,
        view: OrgManagerSidebarContextMenuTarget,
      ) => void)
    | undefined;
}) {
  useOrgManagerSidebarPanel({
    enabled,
    handleContextMenu,
    setView,
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
}: {
  enabled: boolean;
  handleContextMenu?:
    | ((
        event: MouseEvent<HTMLElement>,
        view: OrgManagerSidebarContextMenuTarget,
      ) => void)
    | undefined;
}) {
  return (
    <WindowSidebarProvider>
      <SidebarRegistration
        enabled={enabled}
        handleContextMenu={handleContextMenu}
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
  expect(
    view.getByText(ORG_MANAGER_LABELS.directory).closest("button")?.className,
  ).toContain("mini-app-row--selected");

  view.rerender(<SidebarHarness enabled={false} />);

  await waitFor(() => {
    expect(view.queryByText(ORG_MANAGER_LABELS.directory)).toBeNull();
  });
});

test("org manager sidebar is navigation-only and omits the switcher", async () => {
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
