import { afterEach, expect, test } from "bun:test";
import {
  type ContainerItemRow,
  type ContainerNode,
  syncedContainerDocumentObjectSyncState,
} from "@tearleads/client-sdk";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { type MouseEvent, useRef, useState } from "react";
import type { ImportExplorerDroppedFiles } from "../../../stores/explorer/useExplorerDroppedFileImport";
import { createExplorerContainerRulesContext } from "../containerRules";
import {
  ExplorerContextMenuLayer,
  type ExplorerContextMenuState,
  useExplorerContextMenu,
} from "./ExplorerContextMenu";

afterEach(() => cleanup());

const emptyRulesContext = createExplorerContainerRulesContext({
  contactsContainerId: null,
  contactsSystemSlot: null,
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

function ExplorerContextMenuLayerHarness(params: {
  canDeleteSelectedDocument?: boolean;
  canPurgeSelectedDocument?: boolean;
  canUploadToContextMenuNode?: boolean;
  contextMenu?: ExplorerContextMenuState | null;
  deleteDocument?: (localId: string, containerId: string) => Promise<unknown>;
  importDroppedFiles: ImportExplorerDroppedFiles;
  purgeDocument?: (localId: string, containerId: string) => Promise<unknown>;
}) {
  const [contextMenu, setContextMenu] =
    useState<ExplorerContextMenuState | null>(
      params.contextMenu ?? {
        id: { kind: "container", containerId: rootNode.id },
        position: { x: 12, y: 34 },
      },
    );

  return (
    <ExplorerContextMenuLayer
      canDeleteContextMenuNode={false}
      canDeleteSelectedDocument={params.canDeleteSelectedDocument ?? false}
      canLinkSelectedDocument={false}
      canMoveContextMenuNode={false}
      canRenameContextMenuNode={false}
      canUploadToContextMenuNode={params.canUploadToContextMenuNode ?? true}
      canMoveSelectedDocument={false}
      canPurgeSelectedDocument={params.canPurgeSelectedDocument ?? false}
      closeContextMenu={() => setContextMenu(null)}
      contextMenu={contextMenu}
      deleteDocument={params.deleteDocument ?? (async () => null)}
      importDroppedFiles={params.importDroppedFiles}
      openContainerInfoRoute={() => {}}
      openCreateChildModal={() => {}}
      openDeleteModal={() => {}}
      openDocumentInfoRoute={() => {}}
      openLinkDocumentModal={() => {}}
      openMoveDocumentModal={() => {}}
      openMoveModal={() => {}}
      openRenameModal={() => {}}
      purgeDocument={params.purgeDocument ?? (async () => null)}
      selectContainer={() => {}}
    />
  );
}

test("container upload uses the target captured before opening the file picker", async () => {
  const uploadedFiles = [
    new File(["hello"], "hello.txt", { type: "text/plain" }),
  ];
  const imports: Array<{
    containerId: string;
    files: ReadonlyArray<File>;
  }> = [];
  const importDroppedFiles: ImportExplorerDroppedFiles = async (
    containerId,
    files,
  ) => {
    imports.push({ containerId, files });
    return {
      completedCount: files.length,
      failedCount: 0,
      importedCount: files.length,
      importedDocuments: [],
      totalCount: files.length,
    };
  };

  const view = render(
    <ExplorerContextMenuLayerHarness importDroppedFiles={importDroppedFiles} />,
  );
  const fileInput = view.container.querySelector<HTMLInputElement>(
    "input.explorer-file-input",
  );
  expect(fileInput).toBeTruthy();
  if (!fileInput) {
    return;
  }

  fireEvent.click(view.getByRole("button", { name: "Upload" }));
  fireEvent.change(fileInput, { target: { files: uploadedFiles } });

  await waitFor(() => {
    expect(imports).toHaveLength(1);
  });
  expect(imports[0]?.containerId).toBe(rootNode.id);
  expect(imports[0]?.files).toEqual(uploadedFiles);
  expect(view.queryByRole("button", { name: "Upload" })).toBeNull();
});

test("container upload is disabled for upload-protected containers", () => {
  const view = render(
    <ExplorerContextMenuLayerHarness
      canUploadToContextMenuNode={false}
      importDroppedFiles={noopImportDroppedFiles}
    />,
  );

  const uploadButton = view.getByRole("button", {
    name: "Upload",
  }) as HTMLButtonElement;
  expect(uploadButton.disabled).toBe(true);
});

test("document context menu deletes the selected document", async () => {
  const deletes: Array<{ containerId: string; localId: string }> = [];
  const importDroppedFiles: ImportExplorerDroppedFiles = async () => ({
    completedCount: 0,
    failedCount: 0,
    importedCount: 0,
    importedDocuments: [],
    totalCount: 0,
  });
  const view = render(
    <ExplorerContextMenuLayerHarness
      canDeleteSelectedDocument
      contextMenu={{
        id: {
          kind: "document",
          containerId: rootNode.id,
          localId: "document-1",
        },
        position: { x: 12, y: 34 },
      }}
      deleteDocument={async (localId, containerId) => {
        deletes.push({ containerId, localId });
        return null;
      }}
      importDroppedFiles={importDroppedFiles}
    />,
  );

  fireEvent.click(view.getByRole("button", { name: "Delete" }));

  await waitFor(() => {
    expect(deletes).toEqual([
      { containerId: rootNode.id, localId: "document-1" },
    ]);
  });
  expect(view.queryByRole("button", { name: "Delete" })).toBeNull();
});

const documentContextMenu: ExplorerContextMenuState = {
  id: {
    kind: "document",
    containerId: rootNode.id,
    localId: "document-1",
  },
  position: { x: 12, y: 34 },
};

const noopImportDroppedFiles: ImportExplorerDroppedFiles = async () => ({
  completedCount: 0,
  failedCount: 0,
  importedCount: 0,
  importedDocuments: [],
  totalCount: 0,
});

test("document context menu disables Delete Forever outside the trash", () => {
  const view = render(
    <ExplorerContextMenuLayerHarness
      contextMenu={documentContextMenu}
      importDroppedFiles={noopImportDroppedFiles}
    />,
  );

  const purgeButton = view.getByRole("button", {
    name: "Delete Forever",
  }) as HTMLButtonElement;
  expect(purgeButton).toBeTruthy();
  expect(purgeButton.disabled).toBe(true);
});

test("document context menu purges the selected document forever", async () => {
  const purges: Array<{ containerId: string; localId: string }> = [];
  const view = render(
    <ExplorerContextMenuLayerHarness
      canPurgeSelectedDocument
      contextMenu={documentContextMenu}
      importDroppedFiles={noopImportDroppedFiles}
      purgeDocument={async (localId, containerId) => {
        purges.push({ containerId, localId });
        return null;
      }}
    />,
  );

  fireEvent.click(view.getByRole("button", { name: "Delete Forever" }));

  await waitFor(() => {
    expect(purges).toEqual([
      { containerId: rootNode.id, localId: "document-1" },
    ]);
  });
  expect(view.queryByRole("button", { name: "Delete Forever" })).toBeNull();
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
