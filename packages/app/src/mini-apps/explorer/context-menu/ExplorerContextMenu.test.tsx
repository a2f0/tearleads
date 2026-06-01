import { afterEach, expect, test } from "bun:test";
import {
  type ContainerNode,
  syncedContainerDocumentObjectSyncState,
} from "@tearleads/client-sdk";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import type { ImportExplorerDroppedFiles } from "../../../stores/explorer/useExplorerDroppedFileImport";
import {
  ExplorerContextMenuLayer,
  type ExplorerContextMenuState,
} from "./ExplorerContextMenu";

afterEach(() => cleanup());

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
  contextMenu?: ExplorerContextMenuState | null;
  deleteDocument?: (localId: string, containerId: string) => Promise<unknown>;
  importDroppedFiles: ImportExplorerDroppedFiles;
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
      canMoveSelectedDocument={false}
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
