import { afterEach, expect, test } from "bun:test";
import {
  type ContainerNode,
  syncedContainerDocumentObjectSyncState,
} from "@tearleads/client-sdk";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import type { ImportExplorerDroppedFiles } from "../../../stores/explorer/useExplorerDroppedFileImport";
import { EXPLORER_LABELS } from "../labels";
import type {
  ExplorerContainerContextMenuVariant,
  ExplorerContextMenuState,
} from "./ExplorerContextMenu";
import { ExplorerContextMenuLayer } from "./ExplorerContextMenuLayer";

afterEach(() => cleanup());

const rootNode: ContainerNode = {
  id: "root-container",
  kind: "container",
  name: "/",
  organizationId: "org-1",
  parentId: null,
  syncState: syncedContainerDocumentObjectSyncState,
};

const noopImportDroppedFiles: ImportExplorerDroppedFiles = async () => ({
  completedCount: 0,
  failedCount: 0,
  importedCount: 0,
  importedDocuments: [],
  totalCount: 0,
});

function ExplorerContextMenuLayerHarness(params: {
  canCreateChildContextMenuNode?: boolean;
  canCreateStructuredDocumentContextMenuNode?: boolean;
  canDeleteSelectedDocument?: boolean;
  canPurgeSelectedDocument?: boolean;
  canUploadToContextMenuNode?: boolean;
  containerContextMenuVariant?: ExplorerContainerContextMenuVariant;
  contextMenu?: ExplorerContextMenuState | null;
  deleteDocument?: (localId: string, containerId: string) => Promise<unknown>;
  importDroppedFiles: ImportExplorerDroppedFiles;
  openContainerInfoRoute?: (containerId: string) => void;
  openNewContactDocument?: (containerId: string) => void;
  openNewStructuredDocumentRoute?: (containerId: string) => void;
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
      canCreateChildContextMenuNode={
        params.canCreateChildContextMenuNode ?? true
      }
      canCreateStructuredDocumentContextMenuNode={
        params.canCreateStructuredDocumentContextMenuNode ?? true
      }
      containerContextMenuVariant={
        params.containerContextMenuVariant ?? "default"
      }
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
      openContainerInfoRoute={params.openContainerInfoRoute ?? (() => {})}
      openCreateChildModal={() => {}}
      openDeleteModal={() => {}}
      openDocumentInfoRoute={() => {}}
      openLinkDocumentModal={() => {}}
      openMoveDocumentModal={() => {}}
      openMoveModal={() => {}}
      openNewContactDocument={params.openNewContactDocument ?? (() => {})}
      openNewStructuredDocumentRoute={
        params.openNewStructuredDocumentRoute ?? (() => {})
      }
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

test("container upload handles rejected import promises", async () => {
  const uploadedFiles = [
    new File(["hello"], "hello.txt", { type: "text/plain" }),
  ];
  const attemptedContainerIds: string[] = [];
  const importDroppedFiles: ImportExplorerDroppedFiles = async (
    containerId,
  ) => {
    attemptedContainerIds.push(containerId);
    throw new Error("failed upload");
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
    expect(attemptedContainerIds).toEqual([rootNode.id]);
  });
  expect(view.queryByRole("button", { name: "Upload" })).toBeNull();
});

test("container context menu opens a new structured document in the target", () => {
  const openedContainerIds: string[] = [];
  const view = render(
    <ExplorerContextMenuLayerHarness
      importDroppedFiles={noopImportDroppedFiles}
      openNewStructuredDocumentRoute={(containerId) =>
        openedContainerIds.push(containerId)
      }
    />,
  );

  fireEvent.click(
    view.getByRole("button", { name: "New Structured Document" }),
  );

  expect(openedContainerIds).toEqual([rootNode.id]);
  expect(
    view.queryByRole("button", { name: "New Structured Document" }),
  ).toBeNull();
});

test("container context menu disables creation actions for protected containers", () => {
  const view = render(
    <ExplorerContextMenuLayerHarness
      canCreateChildContextMenuNode={false}
      canCreateStructuredDocumentContextMenuNode={false}
      importDroppedFiles={noopImportDroppedFiles}
    />,
  );

  const createChildButton = view.getByRole("button", {
    name: "Create Child",
  }) as HTMLButtonElement;
  const structuredDocumentButton = view.getByRole("button", {
    name: "New Structured Document",
  }) as HTMLButtonElement;

  expect(createChildButton.disabled).toBe(true);
  expect(structuredDocumentButton.disabled).toBe(true);
});

test("contacts container context menu only shows get info and new contact", () => {
  const openedContactContainers: string[] = [];
  const view = render(
    <ExplorerContextMenuLayerHarness
      containerContextMenuVariant="contacts"
      importDroppedFiles={noopImportDroppedFiles}
      openNewContactDocument={(containerId) =>
        openedContactContainers.push(containerId)
      }
    />,
  );

  expect(
    view.getAllByRole("button").map((button) => button.textContent),
  ).toEqual([
    EXPLORER_LABELS.documentInfoGetInfoAction,
    EXPLORER_LABELS.newContactAction,
  ]);

  fireEvent.click(
    view.getByRole("button", { name: EXPLORER_LABELS.newContactAction }),
  );

  expect(openedContactContainers).toEqual([rootNode.id]);
  expect(
    view.queryByRole("button", { name: EXPLORER_LABELS.newContactAction }),
  ).toBeNull();
});

test("contacts container context menu opens container info", () => {
  const openedInfoContainers: string[] = [];
  const view = render(
    <ExplorerContextMenuLayerHarness
      containerContextMenuVariant="contacts"
      importDroppedFiles={noopImportDroppedFiles}
      openContainerInfoRoute={(containerId) =>
        openedInfoContainers.push(containerId)
      }
    />,
  );

  fireEvent.click(
    view.getByRole("button", {
      name: EXPLORER_LABELS.documentInfoGetInfoAction,
    }),
  );

  expect(openedInfoContainers).toEqual([rootNode.id]);
  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.documentInfoGetInfoAction,
    }),
  ).toBeNull();
});

test("system container context menu hides unavailable actions", () => {
  const view = render(
    <ExplorerContextMenuLayerHarness
      canCreateChildContextMenuNode={false}
      canCreateStructuredDocumentContextMenuNode={false}
      canUploadToContextMenuNode={false}
      containerContextMenuVariant="system"
      importDroppedFiles={noopImportDroppedFiles}
    />,
  );

  expect(
    view.getAllByRole("button").map((button) => button.textContent),
  ).toEqual([EXPLORER_LABELS.documentInfoGetInfoAction]);
  expect(view.queryByRole("button", { name: "Create Child" })).toBeNull();
  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.newStructuredDocumentAction,
    }),
  ).toBeNull();
  expect(view.queryByRole("button", { name: "Upload" })).toBeNull();
  expect(view.queryByRole("button", { name: "Rename" })).toBeNull();
  expect(view.queryByRole("button", { name: "Move" })).toBeNull();
  expect(view.queryByRole("button", { name: "Delete" })).toBeNull();
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
