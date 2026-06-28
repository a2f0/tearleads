import { expect, test } from "bun:test";
import * as rootEntrypoint from "./index";
import {
  type BlobInfoInput,
  type ContainerDocumentObjectSyncState,
  type ContainerDocumentQueriesLinkInput,
  clearRemoteSyncState,
  createBrowserLocalKeyring,
  createContainerDocumentObjectSyncState,
  createDocumentProjectorRegistry,
  createEncryptedBlobStore,
  createEncryptedOpfsBlobStore,
  createIndexedDbWrappingKeyKeystore,
  createLocalKeyring,
  createLocalStorageLocalKeyringManifestStore,
  createMemoryBlobStore,
  createMemoryLocalKeyringManifestStore,
  createMemoryWrappingKeyKeystore,
  createPinCodeBrowserLocalKeyring,
  createPinCodeWrappingKeyKeystore,
  createWebViewLocalKeyring,
  DEFAULT_DOCUMENT_KIND,
  type DocumentAttachmentUpload,
  getDocumentClientProjectionTables,
  isPinCodeWrappedLocalSecretEnvelope,
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
  expect(clearRemoteSyncState).toBeFunction();
  expect(createEncryptedBlobStore).toBeFunction();
  expect(createEncryptedOpfsBlobStore).toBeFunction();
  expect(createBrowserLocalKeyring).toBeFunction();
  expect(createIndexedDbWrappingKeyKeystore).toBeFunction();
  expect(createLocalKeyring).toBeFunction();
  expect(createLocalStorageLocalKeyringManifestStore).toBeFunction();
  expect(createMemoryLocalKeyringManifestStore).toBeFunction();
  expect(createMemoryWrappingKeyKeystore).toBeFunction();
  expect(createPinCodeBrowserLocalKeyring).toBeFunction();
  expect(createPinCodeWrappingKeyKeystore).toBeFunction();
  expect(createWebViewLocalKeyring).toBeFunction();
  expect(isPinCodeWrappedLocalSecretEnvelope).toBeFunction();
  expect(getDocumentClientProjectionTables).toBeFunction();
  expect(createMemoryBlobStore).toBeFunction();
  expect(syncState.status).toBe("pending");
  expect(syncedContainerDocumentObjectSyncState.status).toBe("synced");
});

// The deliberate public runtime (value) surface of the root entry point. The
// architecture lint guarantees the root barrel only re-exports from approved
// facade modules, and knip treats this file as a package entry, so neither
// catches a NEW symbol added to an already-approved facade barrel silently
// widening the public API. This inventory does: any added/removed value export
// fails here, forcing a reviewed, intentional contract change. When you mean to
// change the public surface, update this list in the same PR.
const EXPECTED_ROOT_VALUE_EXPORTS = [
  "Blobs",
  "DEFAULT_DOCUMENT_ACCESS_EPOCH",
  "DEFAULT_DOCUMENT_ID",
  "DEFAULT_DOCUMENT_KIND",
  "DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME",
  "DOCUMENTS_APP_KIND",
  "Database",
  "Events",
  "IDENTITY_KEY_PACKAGE_FORMAT",
  "LOCAL_KEYRING_MANIFEST_FORMAT",
  "Network",
  "ORGANIZATION_PROFILE_DOCUMENT_KIND",
  "ORGANIZATION_ROSTER_PROFILE_CONTAINER_NAME",
  "ROSTER_PROFILE_DOCUMENT_KIND",
  "Tearleads",
  "WRAPPED_LOCAL_SECRET_FORMAT",
  "addDocumentAttachments",
  "addOrganizationGroupUser",
  "bootstrapRootContainer",
  "buildInitialGroupPolicyRequest",
  "buildInitialMemberGroupPolicyRequest",
  "buildInitialOrganizationPolicyRequest",
  "buildMaterializedDocumentCreatePlan",
  "buildOrganizationProfileDocumentPatch",
  "buildRootContainerCreatePlan",
  "buildRosterProfileDocumentPatch",
  "cacheReferencedPrincipalPolicies",
  "clearRemoteSyncState",
  "createBlobStore",
  "createBrowserLocalKeyring",
  "createContainerContentsDocumentsRuntime",
  "createContainerContentsProjectionUserKeyResolver",
  "createContainerContentsStore",
  "createContainerContentsStoreState",
  "createContainerContentsStoreSyncAgent",
  "createContainerContentsSyncLane",
  "createContainerContentsWorkflowRuntime",
  "createContainerDocumentObjectSyncState",
  "createContainerParentSyncLane",
  "createDocumentProjectionUserKeyResolver",
  "createDocumentProjectorRegistry",
  "createDocumentSignerDeviceId",
  "createDocumentStore",
  "createDocumentsWorkflowRuntime",
  "createDomainScope",
  "createEncryptedBlobStore",
  "createEncryptedOpfsBlobStore",
  "createIndexedDbWrappingKeyKeystore",
  "createInitialRootMetadataBootstrap",
  "createInitializedContainerMetadataDocument",
  "createInitializedRosterProfileDocument",
  "createLazyEncryptedBlobStore",
  "createLocalKeyring",
  "createLocalStorageLocalKeyringManifestStore",
  "createMemoryBlobStore",
  "createMemoryLocalKeyringManifestStore",
  "createMemoryWrappingKeyKeystore",
  "createOrganizationGroup",
  "createPinCodeBrowserLocalKeyring",
  "createPinCodeWrappingKeyKeystore",
  "createRemoteContainer",
  "createRemoteDocument",
  "createWebViewLocalKeyring",
  "decodeLocalKeyringSqliteKey",
  "decryptDocumentAttachmentBlob",
  "defaultContainerContentsPersistence",
  "defaultDocumentProjectorRegistry",
  "defaultDocumentsPersistence",
  "deletePersistedDocument",
  "deriveContainerSystemSlot",
  "deriveOrganizationRosterProfileContainerSystemSlot",
  "deriveStoredDocumentTitle",
  "encodeLocalKeyringSqliteKey",
  "enqueueReconciliationForEvents",
  "ensureDocumentAttachmentStructure",
  "getDocumentAttachments",
  "getDocumentClientProjectionTables",
  "getDomainSyncCoordinatorSnapshot",
  "getOrCreateContainerContentsStore",
  "getOrCreateDocumentStore",
  "getOrCreateDomainSyncCoordinator",
  "getOrganizationProfileDocumentLocalId",
  "getRosterProfileDocumentLocalId",
  "getStoredDocumentTypeLabel",
  "getUntitledDocumentTitle",
  "hasDomainSyncCoordinatorPendingWork",
  "hydrateDocumentAttachmentBlobs",
  "importOrganizationUserRecipient",
  "initializeDocumentLinksSchema",
  "initializeStoredDocumentKind",
  "isPinCodeWrappedLocalSecretEnvelope",
  "listBlobInfo",
  "listDocumentLinkedContainerIds",
  "loadContainerInfo",
  "loadContainerSyncWatermark",
  "loadDocumentInfo",
  "loadOrganizationContainerGrants",
  "loadOrganizationDataUsage",
  "loadOrganizationDirectoryAndGroups",
  "loadOrganizationGroupDetails",
  "loadOrganizationGroupPolicyHistory",
  "loadOrganizationPolicyHistory",
  "loadOrganizationUserDetail",
  "localKeyringScopeKey",
  "moveRemoteContainer",
  "normalizeLocalKeyringScope",
  "openDocumentStore",
  "parseLocalKeyringManifest",
  "persistRegistrationBootstrap",
  "persistedDocumentCreateStateFromResponse",
  "projectStoredDocumentState",
  "purgeOpfsBlobStore",
  "readOrganizationProfileName",
  "readStoredDocumentState",
  "readStringDocumentField",
  "registerIdentity",
  "removeOrganizationGroupUser",
  "replaceDocumentLinks",
  "requestDomainDocumentSync",
  "resolveOpIdAttribution",
  "revokeOrganizationContainerGrant",
  "revokeRemoteContainer",
  "rootContainerWriterProjectionFromCreatePlan",
  "sameDocumentAttachments",
  "saveContainerSyncWatermark",
  "serializeLocalKeyringManifest",
  "shareRemoteContainer",
  "shareRemoteContainerWithGroup",
  "subscribeToContainerContentsStore",
  "subscribeToDomainSyncCoordinator",
  "subscribeToPersistedDocuments",
  "summarizeDocumentContributors",
  "syncedContainerDocumentObjectSyncState",
  "unwrapContainerKekPath",
  "unwrapDocumentContentKeyTarget",
  "updateContainerContentsSnapshot",
  "updateContainerContentsStoreRuntime",
  "updateOrganizationProfile",
  "updateOrganizationRosterEntry",
  "uploadDocumentAttachment",
  "waitForDomainSyncCoordinatorToSettle",
  "wrapEncryptedBlobStore",
  "writeStoredDocumentFields",
  "writerByPeerId",
] as const;

test("root entrypoint value surface matches the deliberate public contract", () => {
  const actual = Object.keys(rootEntrypoint).sort();
  expect(actual).toEqual([...EXPECTED_ROOT_VALUE_EXPORTS]);
});
