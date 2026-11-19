import { afterEach, expect, test } from "bun:test";
import type { ContainerNode } from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState as syncedState } from "@tearleads/client-sdk";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { EXPLORER_ORPHANED_DOCUMENTS_ID } from "../../../stores/explorer/orphanedDocuments";
import { ExplorerSidebarVirtualTree } from "./ExplorerSidebarRowViews";

afterEach(() => cleanup());

function createIconNode(icon: string | undefined): ContainerNode {
  return {
    id: "child-container",
    ...(icon ? { icon } : {}),
    kind: "container",
    name: "Child",
    organizationId: "org-1",
    parentId: "root-container",
    syncState: syncedState,
  };
}

function renderSidebarIcon(icon: string | undefined) {
  const node = createIconNode(icon);
  return (
    <ExplorerSidebarVirtualTree
      activeContainerId={null}
      offset={0}
      onContextMenu={() => undefined}
      onSelectContainer={() => undefined}
      onToggleCollapsed={() => undefined}
      rows={[
        {
          depth: 1,
          entry: { children: [], node },
          isCollapsed: false,
          key: node.id,
          kind: "container",
        },
      ]}
      selectedId={null}
      totalRows={1}
    />
  );
}

test("explorer sidebar row updates when a container icon changes", async () => {
  const view = render(renderSidebarIcon("folder"));
  const childButton = await view.findByRole("button", { name: "Child" });
  expect(
    childButton
      .querySelector(".explorer-folder-icon")
      ?.getAttribute("data-icon"),
  ).toBe("folder");

  view.rerender(renderSidebarIcon("playlist"));

  await waitFor(() => {
    const updatedChildButton = view.getByRole("button", { name: "Child" });
    expect(
      updatedChildButton
        .querySelector(".explorer-folder-icon")
        ?.getAttribute("data-icon"),
    ).toBe("playlist");
  });
});

test("the recovery collection suppresses the native context menu", () => {
  const node: ContainerNode = {
    id: EXPLORER_ORPHANED_DOCUMENTS_ID,
    kind: "container",
    name: "Orphaned Documents",
    organizationId: "org-1",
    parentId: null,
    syncState: syncedState,
  };
  const view = render(
    <ExplorerSidebarVirtualTree
      activeContainerId={node.id}
      offset={0}
      onContextMenu={() => undefined}
      onSelectContainer={() => undefined}
      onToggleCollapsed={() => undefined}
      rows={[
        {
          depth: 0,
          entry: { children: [], node },
          isCollapsed: false,
          key: node.id,
          kind: "container",
        },
      ]}
      selectedId={node.id}
      totalRows={1}
    />,
  );

  expect(
    fireEvent.contextMenu(
      view.getByRole("button", { name: "Orphaned Documents" }),
    ),
  ).toBe(false);
});
