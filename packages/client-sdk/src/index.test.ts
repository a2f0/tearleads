import { expect, test } from "bun:test";
import {
  type BlobInfoInput,
  type ContainerDocumentObjectSyncState,
  type ContainerDocumentQueriesLinkInput,
  createContainerDocumentObjectSyncState,
  createDocumentProjectorRegistry,
  createEncryptedBlobStore,
  createEncryptedOpfsBlobStore,
  createLocalKeyring,
  createMemoryBlobStore,
  createMemoryLocalKeyringManifestStore,
  createMemoryWrappingKeyKeystore,
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
  const queriesLink: ContainerDocumentQueriesLinkInput = {
    containerIds: ["container-1"],
    documentId: "document-1",
  };
  const blobInfoInput: BlobInfoInput = { query: "blob-1" };

  expect(upload.bytes).toBeInstanceOf(Uint8Array);
  expect(blobInfoInput.query).toBe("blob-1");
  expect(queriesLink.containerIds).toEqual(["container-1"]);
  expect(DEFAULT_DOCUMENT_KIND).toBe("note");
  expect(createDocumentProjectorRegistry).toBeFunction();
  expect(createEncryptedBlobStore).toBeFunction();
  expect(createEncryptedOpfsBlobStore).toBeFunction();
  expect(createLocalKeyring).toBeFunction();
  expect(createMemoryLocalKeyringManifestStore).toBeFunction();
  expect(createMemoryWrappingKeyKeystore).toBeFunction();
  expect(getDocumentClientProjectionTables).toBeFunction();
  expect(createMemoryBlobStore).toBeFunction();
  expect(syncState.status).toBe("pending");
  expect(syncedContainerDocumentObjectSyncState.status).toBe("synced");
});
