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
  importDroppedFiles: ImportExplorerDroppedFiles;
}) {
  const [contextMenu, setContextMenu] =
    useState<ExplorerContextMenuState | null>({
      id: { kind: "container", containerId: rootNode.id },
      position: { x: 12, y: 34 },
    });

  return (
    <ExplorerContextMenuLayer
      canDeleteContextMenuNode={false}
      canLinkSelectedDocument={false}
      canMoveContextMenuNode={false}
      canMoveSelectedDocument={false}
      closeContextMenu={() => setContextMenu(null)}
      contextMenu={contextMenu}
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
  fileInput.click = () => {
    fireEvent.change(fileInput, { target: { files: uploadedFiles } });
  };

  fireEvent.click(view.getByRole("button", { name: "Upload" }));

  await waitFor(() => {
    expect(imports).toHaveLength(1);
  });
  expect(imports[0]?.containerId).toBe(rootNode.id);
  expect(imports[0]?.files).toEqual(uploadedFiles);
  expect(view.queryByRole("button", { name: "Upload" })).toBeNull();
});
