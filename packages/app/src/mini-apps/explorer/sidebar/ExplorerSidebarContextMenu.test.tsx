import { afterEach, expect, test } from "bun:test";
import type { ContainerNode } from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState } from "@tearleads/client-sdk";
import { WindowStateProvider } from "@tearleads/windowing";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from "react";
import { AppNavigationProvider } from "../../../navigation/AppNavigationProvider";
import type { MiniAppDefinition, MiniAppId } from "../../types";
import { useExplorerSidebarPanel } from "./ExplorerTree";
import { buildExplorerTree } from "./explorerTreeModel";

afterEach(() => cleanup());

const rootNode: ContainerNode = {
  id: "root-container",
  kind: "container",
  name: "Root",
  organizationId: "org-1",
  parentId: null,
  syncState: syncedContainerDocumentObjectSyncState,
};

// Stable identity: the sidebar memoizes on this prop, so an inline map would
// recreate the sidebar every render and loop useRegisteredWindowSidebar.
const NO_ORGANIZATION_NAMES: ReadonlyMap<string, string> = new Map();
const TEST_MINI_APPS = {} as Readonly<Record<MiniAppId, MiniAppDefinition>>;

function SidebarContextMenuHarness(params: {
  onContainerContextMenu: (containerId: string) => void;
}) {
  const nodes = useMemo(() => [rootNode], []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sidebar, setSidebar] = useState<ReactNode>(null);
  const collapsedIds = useMemo(() => new Set<string>(), []);
  const treeEntries = useMemo(() => buildExplorerTree(nodes), [nodes]);
  const handleContainerContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>, containerId: string) => {
      event.preventDefault();
      params.onContainerContextMenu(containerId);
    },
    [params.onContainerContextMenu],
  );
  const toggleCollapsed = useCallback(() => undefined, []);
  // Stable identity: the sidebar memoizes on this, so an inline function would
  // recreate the sidebar every render and loop useRegisteredWindowSidebar.
  const onRetryDatabase = useCallback(() => undefined, []);

  useExplorerSidebarPanel({
    activeContainerId: rootNode.id,
    collapsedIds,
    databaseError: false,
    onRetryDatabase,
    handleContainerContextMenu,
    ready: true,
    organizationNamesById: NO_ORGANIZATION_NAMES,
    primaryOrganizationId: rootNode.organizationId,
    selectedId,
    setSelectedId,
    setSidebar,
    toggleCollapsed,
    treeEntries,
  });

  return <div>{sidebar}</div>;
}

test("explorer sidebar opens the root context menu from blank space", async () => {
  const containerIds: string[] = [];
  const view = render(
    <WindowStateProvider>
      <AppNavigationProvider
        mode="windowed"
        launcher={{ apps: TEST_MINI_APPS }}
      >
        <SidebarContextMenuHarness
          onContainerContextMenu={(containerId) => {
            containerIds.push(containerId);
          }}
        />
      </AppNavigationProvider>
    </WindowStateProvider>,
  );

  await waitFor(() => {
    expect(view.getByRole("button", { name: "Root" })).toBeTruthy();
  });
  const sidebarBlankSpace = view.container.querySelector(
    ".explorer-sidebar-virtual-space",
  );
  if (!sidebarBlankSpace) {
    throw new Error("Expected explorer sidebar blank space.");
  }

  const defaultAllowed = fireEvent.contextMenu(sidebarBlankSpace);

  expect(defaultAllowed).toBe(false);
  expect(containerIds).toEqual([rootNode.id]);
});
