import { afterEach, expect, test } from "bun:test";
import type { ContainerNode } from "@tearleads/client-sdk";
import { syncedContainerDocumentObjectSyncState as syncedState } from "@tearleads/client-sdk";
import { cleanup, fireEvent } from "@testing-library/react";
import {
  getSidebarViewport,
  renderExplorerSidebar,
  rootNode,
} from "./ExplorerTree.testFixtures";

afterEach(cleanup);

test("explorer sidebar renders configured Phosphor icons for containers", async () => {
  const childNodes: ContainerNode[] = [
    rootNode,
    {
      id: "child-container",
      icon: "folder",
      kind: "container",
      name: "Child",
      organizationId: "org-1",
      parentId: "root-container",
      syncState: syncedState,
    },
    {
      id: "trash-container",
      icon: "trash",
      kind: "container",
      name: "Trash",
      organizationId: "org-1",
      parentId: "root-container",
      syncState: syncedState,
    },
  ];
  const view = renderExplorerSidebar({ nodes: childNodes });

  const rootButton = await view.findByRole("button", { name: "Root" });
  const rootIcon = rootButton.querySelector(".explorer-folder-icon");
  expect(rootIcon?.getAttribute("data-icon")).toBe("folder-open");

  const childButton = await view.findByRole("button", { name: "Child" });
  const childIcon = childButton.querySelector(".explorer-folder-icon");
  expect(childIcon?.getAttribute("data-container-icon")).toBe("folder");
  expect(childIcon?.getAttribute("data-icon")).toBe("folder");

  const trashButton = await view.findByRole("button", { name: "Trash" });
  const trashIcon = trashButton.querySelector(".explorer-folder-icon");
  expect(trashIcon?.getAttribute("data-container-icon")).toBe("trash");
  expect(trashIcon?.getAttribute("data-icon")).toBe("trash");

  view.unmount();

  const collapsedView = renderExplorerSidebar({
    collapsedIds: new Set(["root-container"]),
    nodes: childNodes,
  });
  const collapsedRootButton = await collapsedView.findByRole("button", {
    name: "Root",
  });
  const collapsedRootIcon = collapsedRootButton.querySelector(
    ".explorer-folder-icon",
  );
  expect(collapsedRootIcon?.getAttribute("data-icon")).toBe("folder");
});

test("the sidebar scrolls through large container trees", async () => {
  const nodes = Array.from({ length: 80 }, (_, index) => ({
    ...rootNode,
    id: String(index),
    name: `Folder ${String(index).padStart(2, "0")}`,
  }));
  const view = renderExplorerSidebar({ nodes });
  expect(await view.findByRole("button", { name: "Folder 00" })).toBeTruthy();
  expect(view.queryByRole("button", { name: "Folder 40" })).toBeNull();
  const viewport = getSidebarViewport(view);
  viewport.scrollTop = 1120;
  fireEvent.scroll(viewport);
  expect(await view.findByRole("button", { name: "Folder 40" })).toBeTruthy();
});
