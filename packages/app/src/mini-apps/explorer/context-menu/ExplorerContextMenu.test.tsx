import { afterEach, expect, test } from "bun:test";
import {
  type ContainerItemRow,
  type ContainerNode,
  syncedContainerDocumentObjectSyncState,
} from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { type MouseEvent, useRef } from "react";
import {
  createExplorerContainerRulesContext,
  type ExplorerContainerRulesContext,
} from "../containerRules";
import {
  type ExplorerContextMenuState,
  useExplorerContextMenu,
} from "./ExplorerContextMenu";

afterEach(() => cleanup());

const emptyRulesContext = createExplorerContainerRulesContext({
  contactsContainerId: null,
  contactsSystemSlot: null,
  currentOrganizationId: null,
  currentSigningFingerprint: null,
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

// A normal user folder under root: the one node that IS a move-to-trash
// candidate (writable, non-system, not already under Trash).
const userFolderNode: ContainerNode = {
  ...rootNode,
  id: "user-folder",
  name: "User Folder",
  parentId: rootNode.id,
};

const systemRulesContext = createExplorerContainerRulesContext({
  contactsContainerId: contactsNode.id,
  contactsSystemSlot: "contacts-slot",
  currentOrganizationId: null,
  currentSigningFingerprint: null,
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

function ContainerContextMenuVariantHarness(params: {
  nodeId: string;
  nodes?: ReadonlyArray<ContainerNode>;
  rulesContext?: ExplorerContainerRulesContext;
  trashContainerId?: string | null;
  trashSystemSlot?: ContainerSystemSlot | null;
}) {
  const {
    canMoveToTrashContextMenuNode,
    canPurgeContextMenuNode,
    containerContextMenuVariant,
    handleContainerContextMenu,
  } = useExplorerContextMenu(
    params.nodes ?? [
      rootNode,
      contactsNode,
      trashNode,
      trashChildNode,
      userFolderNode,
    ],
    () => {},
    () => {},
    params.rulesContext ?? systemRulesContext,
    params.trashContainerId === undefined
      ? trashNode.id
      : params.trashContainerId,
    params.trashSystemSlot === undefined
      ? "trash-slot"
      : params.trashSystemSlot,
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
      <output aria-label="Can move to trash context menu node">
        {String(canMoveToTrashContextMenuNode)}
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

test("container move-to-trash gate offers Move to Trash only for a normal folder outside trash", () => {
  const expectations: Array<{ label: string; nodeId: string; can: string }> = [
    // A writable, non-system folder under root is the one trashable case.
    { label: "user folder", nodeId: userFolderNode.id, can: "true" },
    // Already under Trash — it is purged, not re-trashed.
    { label: "trashed folder", nodeId: trashChildNode.id, can: "false" },
    // The Trash bin itself is a protected system container.
    { label: "trash bin", nodeId: trashNode.id, can: "false" },
    // Contacts is a protected system container.
    { label: "contacts", nodeId: contactsNode.id, can: "false" },
    // Root cannot be trashed.
    { label: "root", nodeId: rootNode.id, can: "false" },
  ];

  for (const { nodeId, can } of expectations) {
    const view = render(<ContainerContextMenuVariantHarness nodeId={nodeId} />);
    fireEvent.contextMenu(view.getByRole("button", { name: "open" }));
    expect(
      view.getByLabelText("Can move to trash context menu node").textContent,
    ).toBe(can);
    cleanup();
  }
});

test("move-to-trash gate hides for a folder under a DUPLICATE Trash node the resolved id misses", () => {
  // A device-first local-only Trash and its synced twin can briefly coexist for
  // the same org+slot. The folder is moved under the synced twin (trashB), but
  // the resolved trashContainerId (from the raw node list) can point at the
  // other twin (trashA). An id-based under-trash walk from the folder never
  // reaches trashA, so it used to wrongly re-offer "Move to Trash" and hide
  // "Delete Forever"; the slot-based classifier recognizes trashB as Trash.
  const trashA: ContainerNode = {
    ...rootNode,
    id: "trash-a",
    name: "Trash",
    parentId: rootNode.id,
    systemSlot: "trash-slot",
  };
  const trashB: ContainerNode = { ...trashA, id: "trash-b" };
  const trashedFolder: ContainerNode = {
    ...rootNode,
    id: "dup-trashed-folder",
    name: "Trashed Under Twin",
    parentId: trashB.id,
  };

  const view = render(
    <ContainerContextMenuVariantHarness
      nodeId={trashedFolder.id}
      nodes={[rootNode, trashA, trashB, trashedFolder]}
      trashContainerId={trashA.id}
    />,
  );
  fireEvent.contextMenu(view.getByRole("button", { name: "open" }));
  expect(
    view.getByLabelText("Can move to trash context menu node").textContent,
  ).toBe("false");
  expect(view.getByLabelText("Can purge context menu node").textContent).toBe(
    "true",
  );
});

test("move-to-trash gate hides for a folder under a foreign org's shared Trash", () => {
  // A folder trashed into ANOTHER org's shared Trash carries that org's opaque
  // slot, which never matches the viewer's derived trash slot. The viewer's own
  // trashContainerId therefore can't recognize it via an id walk; the classifier
  // matches the foreign "Trash" by name under a foreign shared root.
  const foreignRulesContext = createExplorerContainerRulesContext({
    contactsContainerId: null,
    contactsSystemSlot: null,
    currentOrganizationId: "org-1",
    currentSigningFingerprint: null,
    trashSystemSlot: "trash-slot",
  });
  const foreignRoot: ContainerNode = {
    ...rootNode,
    id: "foreign-root",
    name: "/",
    organizationId: "org-2",
    parentId: null,
  };
  const foreignTrash: ContainerNode = {
    ...foreignRoot,
    id: "foreign-trash",
    name: "Trash",
    parentId: foreignRoot.id,
    systemSlot: "foreign-opaque-trash-slot",
  };
  const foreignFolder: ContainerNode = {
    ...foreignRoot,
    id: "foreign-folder",
    name: "Peer Folder",
    parentId: foreignTrash.id,
  };

  const view = render(
    <ContainerContextMenuVariantHarness
      nodeId={foreignFolder.id}
      nodes={[rootNode, trashNode, foreignRoot, foreignTrash, foreignFolder]}
      rulesContext={foreignRulesContext}
      trashContainerId={trashNode.id}
    />,
  );
  fireEvent.contextMenu(view.getByRole("button", { name: "open" }));
  expect(
    view.getByLabelText("Can move to trash context menu node").textContent,
  ).toBe("false");
  expect(view.getByLabelText("Can purge context menu node").textContent).toBe(
    "true",
  );
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
      if (row.containerId === null) {
        throw new Error("Expected the fixture document to have a container.");
      }
      expect(openedTargets[0]).toEqual({
        kind: "document",
        containerId: row.containerId,
        localId: row.localId,
      });
    }

    cleanup();
  }
});

test("an orphan recovery row has no source-container context menu", () => {
  const navigations: Array<string | null> = [];
  const openedTargets: Array<ExplorerContextMenuState["id"]> = [];
  const view = render(
    <ItemContextMenuHarness
      navigations={navigations}
      openedTargets={openedTargets}
      row={{ ...documentRow, containerId: null }}
    />,
  );

  fireEvent.click(view.getByRole("button", { name: "open" }));

  expect(navigations).toEqual([]);
  expect(openedTargets).toEqual([]);
});
