import { afterEach, expect, test } from "bun:test";
import type { ContainerNode } from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState as syncedState } from "@tearleads/client-sdk";
import { cleanup, render, waitFor } from "@testing-library/react";
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
      currentSigningFingerprint={null}
      currentUserId={null}
      depth={0}
      documentWindowsByContainerId={new Map()}
      offset={0}
      onContextMenu={() => undefined}
      onDocumentContextMenu={() => undefined}
      onRetryDocumentWindow={() => undefined}
      onSelectContainer={() => undefined}
      onSelectDocument={() => undefined}
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
