import { afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { EXPLORER_LABELS } from "../labels";
import type { ExplorerContextMenuState } from "./ExplorerContextMenu";
import {
  ExplorerContextMenuLayerHarness,
  noopStartImport,
  rootNode,
} from "./ExplorerContextMenuLayer.testUtils";

afterEach(() => cleanup());

test("container upload uses the target captured before opening the file picker", async () => {
  const uploadedFiles = [
    new File(["hello"], "hello.txt", { type: "text/plain" }),
  ];
  const imports: Array<{
    containerId: string;
    files: ReadonlyArray<File>;
  }> = [];
  const startImport = (containerId: string, files: ReadonlyArray<File>) => {
    imports.push({ containerId, files });
  };

  const view = render(
    <ExplorerContextMenuLayerHarness startImport={startImport} />,
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

test("container upload is hidden for upload-protected containers", () => {
  const view = render(
    <ExplorerContextMenuLayerHarness
      canUploadToContextMenuNode={false}
      startImport={noopStartImport}
    />,
  );

  expect(view.queryByRole("button", { name: "Upload" })).toBeNull();
});

test("container context menu opens a new structured document in the target", () => {
  const openedContainerIds: string[] = [];
  const view = render(
    <ExplorerContextMenuLayerHarness
      startImport={noopStartImport}
      openNewStructuredDocumentRoute={(containerId) =>
        openedContainerIds.push(containerId)
      }
    />,
  );

  fireEvent.click(
    view.getByRole("button", {
      name: EXPLORER_LABELS.newStructuredDocumentAction,
    }),
  );

  expect(openedContainerIds).toEqual([rootNode.id]);
  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.newStructuredDocumentAction,
    }),
  ).toBeNull();
});

test("container context menu hides creation actions for protected containers", () => {
  const view = render(
    <ExplorerContextMenuLayerHarness
      canCreateChildContextMenuNode={false}
      canCreateStructuredDocumentContextMenuNode={false}
      startImport={noopStartImport}
    />,
  );

  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.createChildFolderAction,
    }),
  ).toBeNull();
  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.newStructuredDocumentAction,
    }),
  ).toBeNull();
});

test("container context menu hides Delete Forever for non-purgeable folders", () => {
  const view = render(
    <ExplorerContextMenuLayerHarness startImport={noopStartImport} />,
  );

  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.documentPurgeAction,
    }),
  ).toBeNull();
});

test("container context menu purges a folder under trash via Delete Forever", () => {
  const purgedContainerIds: string[] = [];
  const view = render(
    <ExplorerContextMenuLayerHarness
      canPurgeContextMenuNode
      startImport={noopStartImport}
      openPurgeModal={(containerId) => purgedContainerIds.push(containerId)}
    />,
  );

  fireEvent.click(
    view.getByRole("button", { name: EXPLORER_LABELS.documentPurgeAction }),
  );

  expect(purgedContainerIds).toEqual([rootNode.id]);
  expect(
    view.queryByRole("button", { name: EXPLORER_LABELS.documentPurgeAction }),
  ).toBeNull();
});

test("container context menu moves a folder to trash via Move to Trash", async () => {
  const trashedContainerIds: string[] = [];
  const view = render(
    <ExplorerContextMenuLayerHarness
      canMoveToTrashContextMenuNode
      startImport={noopStartImport}
      moveContainerToTrash={async (containerId) => {
        trashedContainerIds.push(containerId);
        return null;
      }}
    />,
  );

  fireEvent.click(
    view.getByRole("button", {
      name: EXPLORER_LABELS.containerMoveToTrashAction,
    }),
  );

  await waitFor(() => {
    expect(trashedContainerIds).toEqual([rootNode.id]);
  });
  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.containerMoveToTrashAction,
    }),
  ).toBeNull();
});

test("container context menu hides Move to Trash for non-trashable folders", () => {
  const view = render(
    <ExplorerContextMenuLayerHarness startImport={noopStartImport} />,
  );

  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.containerMoveToTrashAction,
    }),
  ).toBeNull();
});

test("contacts container context menu only shows get info and new contact", () => {
  const openedContactContainers: string[] = [];
  const view = render(
    <ExplorerContextMenuLayerHarness
      containerContextMenuVariant="contacts"
      startImport={noopStartImport}
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
      startImport={noopStartImport}
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
      startImport={noopStartImport}
    />,
  );

  expect(
    view.getAllByRole("button").map((button) => button.textContent),
  ).toEqual([EXPLORER_LABELS.documentInfoGetInfoAction]);
  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.createChildFolderAction,
    }),
  ).toBeNull();
  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.newStructuredDocumentAction,
    }),
  ).toBeNull();
  expect(view.queryByRole("button", { name: "Upload" })).toBeNull();
  expect(view.queryByRole("button", { name: "Rename" })).toBeNull();
  expect(view.queryByRole("button", { name: "Move" })).toBeNull();
  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.containerMoveToTrashAction,
    }),
  ).toBeNull();
});

test("document context menu deletes the selected document", async () => {
  const deletes: Array<{ containerId: string; localId: string }> = [];
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
      startImport={noopStartImport}
    />,
  );

  fireEvent.click(
    view.getByRole("button", {
      name: EXPLORER_LABELS.documentDeleteAction,
    }),
  );

  await waitFor(() => {
    expect(deletes).toEqual([
      { containerId: rootNode.id, localId: "document-1" },
    ]);
  });
  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.documentDeleteAction,
    }),
  ).toBeNull();
});

const documentContextMenu: ExplorerContextMenuState = {
  id: {
    kind: "document",
    containerId: rootNode.id,
    localId: "document-1",
  },
  position: { x: 12, y: 34 },
};

test("document context menu hides unavailable actions", () => {
  const view = render(
    <ExplorerContextMenuLayerHarness
      contextMenu={documentContextMenu}
      startImport={noopStartImport}
    />,
  );

  expect(
    view.getAllByRole("button").map((button) => button.textContent),
  ).toEqual([EXPLORER_LABELS.documentInfoGetInfoAction]);
  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.documentLinkAction,
    }),
  ).toBeNull();
  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.documentMoveAction,
    }),
  ).toBeNull();
  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.documentDeleteAction,
    }),
  ).toBeNull();
  expect(
    view.queryByRole("button", { name: EXPLORER_LABELS.documentPurgeAction }),
  ).toBeNull();
});

// Download's disabled/hidden case is covered by "hides unavailable actions".
test("document context menu downloads a file-backed document", () => {
  const downloads: string[] = [];
  const view = render(
    <ExplorerContextMenuLayerHarness
      canDownloadSelectedDocument
      contextMenu={documentContextMenu}
      downloadDocument={(localId) => downloads.push(localId)}
      startImport={noopStartImport}
    />,
  );
  fireEvent.click(
    view.getByRole("button", { name: EXPLORER_LABELS.documentDownloadAction }),
  );
  expect(downloads).toEqual(["document-1"]);
});

test("document context menu purges the selected document forever", async () => {
  const purges: Array<{ containerId: string; localId: string }> = [];
  const view = render(
    <ExplorerContextMenuLayerHarness
      canPurgeSelectedDocument
      contextMenu={documentContextMenu}
      startImport={noopStartImport}
      purgeDocument={async (localId, containerId) => {
        purges.push({ containerId, localId });
        return null;
      }}
    />,
  );

  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.documentDeleteAction,
    }),
  ).toBeNull();
  fireEvent.click(
    view.getByRole("button", {
      name: EXPLORER_LABELS.documentPurgeAction,
    }),
  );

  await waitFor(() => {
    expect(purges).toEqual([
      { containerId: rootNode.id, localId: "document-1" },
    ]);
  });
  expect(
    view.queryByRole("button", {
      name: EXPLORER_LABELS.documentPurgeAction,
    }),
  ).toBeNull();
});
