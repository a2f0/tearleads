import type { ContainerNode } from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState as syncedState } from "@tearleads/client-sdk";
import { WindowStateProvider } from "@tearleads/windowing";
import { type RenderResult, render } from "@testing-library/react";
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

export const rootNode: ContainerNode = {
  id: "root-container",
  kind: "container",
  name: "Root",
  organizationId: "org-1",
  parentId: null,
  syncState: syncedState,
};

const NO_ORGANIZATION_NAMES: ReadonlyMap<string, string> = new Map();

const TEST_MINI_APPS = {} as Readonly<Record<MiniAppId, MiniAppDefinition>>;

function ExplorerSidebarHarness(params: {
  collapsedIds?: ReadonlySet<string>;
  nodes: ReadonlyArray<ContainerNode>;
}) {
  const { collapsedIds: collapsedIdsParam, nodes } = params;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sidebar, setSidebar] = useState<ReactNode>(null);
  const collapsedIds = useMemo(
    () => collapsedIdsParam ?? new Set<string>(),
    [collapsedIdsParam],
  );
  const handleContainerContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => event.preventDefault(),
    [],
  );
  const toggleCollapsed = useCallback(() => undefined, []);
  const treeEntries = useMemo(() => buildExplorerTree(nodes), [nodes]);

  useExplorerSidebarPanel({
    activeContainerId: "root-container",
    collapsedIds,
    handleContainerContextMenu,
    folderState: "available",
    organizationNamesById: NO_ORGANIZATION_NAMES,
    primaryOrganizationId: "org-1",
    selectedId,
    setSelectedId,
    setSidebar,
    toggleCollapsed,
    treeEntries,
  });

  return <div>{sidebar}</div>;
}

type ExplorerSidebarHarnessParams = Parameters<
  typeof ExplorerSidebarHarness
>[0];

function explorerSidebarElement(params: ExplorerSidebarHarnessParams) {
  return (
    <WindowStateProvider>
      <AppNavigationProvider
        mode="windowed"
        launcher={{ apps: TEST_MINI_APPS }}
      >
        <ExplorerSidebarHarness {...params} />
      </AppNavigationProvider>
    </WindowStateProvider>
  );
}

export function renderExplorerSidebar(
  params: ExplorerSidebarHarnessParams,
): RenderResult {
  return render(explorerSidebarElement(params));
}

export function getSidebarViewport(view: { container: HTMLElement }) {
  const sidebarViewport = view.container.querySelector<HTMLDivElement>(
    ".explorer-sidebar-viewport",
  );
  if (!sidebarViewport) {
    throw new Error("Explorer sidebar viewport was not rendered.");
  }
  return sidebarViewport;
}
