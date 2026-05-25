import { expect, test } from "bun:test";
import {
  type ContainerDocumentObjectSyncState,
  type ContainerDocumentReadModelLinkInput,
  createContainerDocumentObjectSyncState,
  createDocumentProjectorRegistry,
  createMemoryBlobStore,
  DEFAULT_DOCUMENT_KIND,
  type DocumentAttachmentUpload,
  getDocumentClientProjectionTables,
  syncedContainerDocumentObjectSyncState,
} from "./index";

test("root entrypoint exposes public facade symbols", () => {
  const upload: DocumentAttachmentUpload = {
    bytes: new Uint8Array([1]),
    mimeType: null,
    name: "example.txt",
  };
  const syncState: ContainerDocumentObjectSyncState =
    createContainerDocumentObjectSyncState({
      pendingUpdateCount: 1,
    });
  const readModelLink: ContainerDocumentReadModelLinkInput = {
    containerIds: ["container-1"],
    documentId: "document-1",
  };

  expect(upload.bytes).toBeInstanceOf(Uint8Array);
  expect(readModelLink.containerIds).toEqual(["container-1"]);
  expect(DEFAULT_DOCUMENT_KIND).toBe("note");
  expect(createDocumentProjectorRegistry).toBeFunction();
  expect(getDocumentClientProjectionTables).toBeFunction();
  expect(createMemoryBlobStore).toBeFunction();
  expect(syncState.status).toBe("pending");
  expect(syncedContainerDocumentObjectSyncState.status).toBe("synced");
});
