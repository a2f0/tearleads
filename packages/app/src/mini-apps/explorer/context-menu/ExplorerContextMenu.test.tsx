import { afterEach, expect, test } from "bun:test";
import {
  type ContainerItemRow,
  type ContainerNode,
  syncedContainerDocumentObjectSyncState,
} from "@tearleads/client-sdk";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { type MouseEvent, useRef } from "react";
import { createExplorerContainerRulesContext } from "../containerRules";
import {
  type ExplorerContextMenuState,
  useExplorerContextMenu,
} from "./ExplorerContextMenu";

afterEach(() => cleanup());

const emptyRulesContext = createExplorerContainerRulesContext({
  contactsContainerId: null,
  contactsSystemSlot: null,
  currentOrganizationId: null,
  trashSystemSlot: null,
});

const rootNode: ContainerNode = {
  id: "root-container",
  kind: "container",
  name: "/",
  organizationId: "org-1",
  parentId: null,
  syncState: syncedContainerDocumentObjectSyncState,
};

const contactsNode: ContainerNode = {
  ...rootNode,
  id: "contacts-container",
  name: "Contacts",
  parentId: rootNode.id,
  systemSlot: "contacts-slot",
};

const trashNode: ContainerNode = {
  ...rootNode,
  id: "trash-container",
  name: "Trash",
  parentId: rootNode.id,
  systemSlot: "trash-slot",
};

// A user folder that has been moved into Trash. Carries no system slot of its
// own, so it is a purge candidate while the Trash bin itself is not.
const trashChildNode: ContainerNode = {
  ...rootNode,
  id: "trashed-folder",
  name: "Trashed Folder",
  parentId: trashNode.id,
};

const systemRulesContext = createExplorerContainerRulesContext({
  contactsContainerId: contactsNode.id,
  contactsSystemSlot: "contacts-slot",
  currentOrganizationId: null,
  trashSystemSlot: "trash-slot",
});

const folderRow: ContainerItemRow = {
  createdAt: null,
  id: "child-container",
  itemKind: "container",
  name: "Child",
  syncState: syncedContainerDocumentObjectSyncState,
  updatedAt: null,
};

const documentRow: ContainerItemRow = {
  containerId: "root-container",
  createdAt: null,
  documentId: "doc-1",
  documentKind: "note",
  itemKind: "document",
  localId: "doc-local-1",
  name: "Note",
  syncState: syncedContainerDocumentObjectSyncState,
  updatedAt: null,
};

function ItemContextMenuHarness(params: {
  navigations: Array<string | null>;
  openedTargets: Array<ExplorerContextMenuState["id"]>;
  row: ContainerItemRow;
}) {
  const { navigations, openedTargets } = params;
  const rowRef = useRef(params.row);
  const { contextMenu, handleItemContextMenu } = useExplorerContextMenu(
    [rootNode],
    (id) => navigations.push(id),
    (localId, containerId) => navigations.push(`${containerId}/${localId}`),
    emptyRulesContext,
    null,
  );

  if (contextMenu && !openedTargets.includes(contextMenu.id)) {
    openedTargets.push(contextMenu.id);
  }

  return (
    <button
      type="button"
      onClick={(event: MouseEvent<HTMLButtonElement>) =>
        handleItemContextMenu(event, rowRef.current)
      }
    >
      open
    </button>
  );
}

function ContainerContextMenuVariantHarness(params: { nodeId: string }) {
  const {
    canPurgeContextMenuNode,
    containerContextMenuVariant,
    handleContainerContextMenu,
  } = useExplorerContextMenu(
    [rootNode, contactsNode, trashNode, trashChildNode],
    () => {},
    () => {},
    systemRulesContext,
    trashNode.id,
  );

  return (
    <>
      <button
        type="button"
        onContextMenu={(event: MouseEvent<HTMLButtonElement>) =>
          handleContainerContextMenu(event, params.nodeId)
        }
      >
        open
      </button>
      <output aria-label="Container context menu variant">
        {containerContextMenuVariant}
      </output>
      <output aria-label="Can purge context menu node">
        {String(canPurgeContextMenuNode)}
      </output>
    </>
  );
}

test("container context menu variant distinguishes contacts from other system containers", () => {
  const contactsView = render(
    <ContainerContextMenuVariantHarness nodeId={contactsNode.id} />,
  );
  fireEvent.contextMenu(contactsView.getByRole("button", { name: "open" }));
  expect(
    contactsView.getByLabelText("Container context menu variant").textContent,
  ).toBe("contacts");
  cleanup();

  const trashView = render(
    <ContainerContextMenuVariantHarness nodeId={trashNode.id} />,
  );
  fireEvent.contextMenu(trashView.getByRole("button", { name: "open" }));
  expect(
    trashView.getByLabelText("Container context menu variant").textContent,
  ).toBe("system");
  cleanup();

  const rootView = render(
    <ContainerContextMenuVariantHarness nodeId={rootNode.id} />,
  );
  fireEvent.contextMenu(rootView.getByRole("button", { name: "open" }));
  expect(
    rootView.getByLabelText("Container context menu variant").textContent,
  ).toBe("default");
});

test("container purge gate offers Delete Forever only for a user folder under trash", () => {
  // A user folder nested in Trash is purgeable...
  const trashedView = render(
    <ContainerContextMenuVariantHarness nodeId={trashChildNode.id} />,
  );
  fireEvent.contextMenu(trashedView.getByRole("button", { name: "open" }));
  expect(
    trashedView.getByLabelText("Can purge context menu node").textContent,
  ).toBe("true");
  cleanup();

  // ...but the Trash bin itself (a system container) is not.
  const trashView = render(
    <ContainerContextMenuVariantHarness nodeId={trashNode.id} />,
  );
  fireEvent.contextMenu(trashView.getByRole("button", { name: "open" }));
  expect(
    trashView.getByLabelText("Can purge context menu node").textContent,
  ).toBe("false");
  cleanup();

  // ...and a normal folder outside trash is not.
  const contactsView = render(
    <ContainerContextMenuVariantHarness nodeId={contactsNode.id} />,
  );
  fireEvent.contextMenu(contactsView.getByRole("button", { name: "open" }));
  expect(
    contactsView.getByLabelText("Can purge context menu node").textContent,
  ).toBe("false");
});

test("right-clicking a detail-pane row opens its menu without navigating", () => {
  for (const row of [folderRow, documentRow]) {
    const navigations: Array<string | null> = [];
    const openedTargets: Array<ExplorerContextMenuState["id"]> = [];
    const view = render(
      <ItemContextMenuHarness
        navigations={navigations}
        openedTargets={openedTargets}
        row={row}
      />,
    );

    fireEvent.click(view.getByRole("button", { name: "open" }));

    // The menu opens for the right-clicked row, but no selection/navigation
    // side effect fires (a left-click is what navigates, not a right-click).
    expect(navigations).toEqual([]);
    expect(openedTargets).toHaveLength(1);
    if (row.itemKind === "container") {
      expect(openedTargets[0]).toEqual({
        kind: "container",
        containerId: row.id,
      });
    } else {
      expect(openedTargets[0]).toEqual({
        kind: "document",
        containerId: row.containerId,
        localId: row.localId,
      });
    }

    cleanup();
  }
});
