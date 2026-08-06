import { expect, test } from "bun:test";
import * as rootEntrypoint from "./index";
import {
  type BlobInfoInput,
  blobByteSourceInputLength,
  type ContainerDocumentObjectSyncState,
  type ContainerDocumentQueriesLinkInput,
  clearRemoteSyncState,
  createBlobByteSource,
  createBrowserLocalKeyring,
  createContainerDocumentObjectSyncState,
  createDocumentProjectorRegistry,
  createEncryptedBlobStore,
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
  readBlobByteSource,
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
  expect(blobByteSourceInputLength(upload.bytes)).toBe(1);
  expect(blobInfoInput.query).toBe("blob-1");
  expect(queriesLink.containerIds).toEqual(["container-1"]);
  expect(DEFAULT_DOCUMENT_KIND).toBe("note");
  expect(createDocumentProjectorRegistry).toBeFunction();
  expect(clearRemoteSyncState).toBeFunction();
  expect(createBlobByteSource).toBeFunction();
  expect(createEncryptedBlobStore).toBeFunction();
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
  expect(readBlobByteSource).toBeFunction();
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
  "DOCUMENT_SYNC_TRACE_FRAGMENT",
  "DOCUMENT_SYNC_TRACE_PATTERN",
  "Database",
  "DirectCheckoutUnavailableError",
  "Events",
  "HistoricalWrapUnavailableError",
  "IDENTITY_KEY_PACKAGE_FORMAT",
  "LOCAL_KEYRING_MANIFEST_FORMAT",
  "Network",
  "ORGANIZATION_METADATA_CONTAINER_NAME",
  "ORGANIZATION_PROFILE_DOCUMENT_KIND",
  "ORGANIZATION_ROSTER_PROFILE_CONTAINER_NAME",
  "PurchaseAbortedError",
  "PurchaseAlreadyOwnedError",
  "PurchaseCancelledError",
  "PurchaseIdentityPendingError",
  "PurchaseProviderStalledError",
  "PurchasesUnavailableError",
  "ROSTER_PROFILE_DOCUMENT_KIND",
  "SyncBillingGate",
  "Tearleads",
  "WRAPPED_LOCAL_SECRET_FORMAT",
  "addDocumentAttachments",
  "addOrganizationGroupUser",
  "blobByteSourceInputLength",
  "bootstrapRootContainer",
  "buildInitialGroupPolicyRequest",
  "buildInitialMemberGroupPolicyRequest",
  "buildInitialOrganizationPolicyRequest",
  "buildMaterializedDocumentCreatePlan",
  "buildOrganizationGroupPolicyHistory",
  "buildOrganizationProfileDocumentPatch",
  "buildRootContainerCreatePlan",
  "buildRosterProfileDocumentPatch",
  "cacheReferencedPrincipalPolicies",
  "clearRemoteSyncState",
  "createBlobByteSource",
  "createBlobStore",
  "createBrowserLocalKeyring",
  "createBrowserLocalKeyringManifestStore",
  "createBrowserNetworkStatusSource",
  "createContainerContentsDocumentsRuntime",
  "createContainerContentsProjectionUserKeyResolver",
  "createContainerContentsStore",
  "createContainerContentsStoreState",
  "createContainerContentsStoreSyncAgent",
  "createContainerContentsStoreWorkflowRuntime",
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
  "createIndexedDbLocalKeyringManifestStore",
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
  "createRevenueCatPurchases",
  "createUnavailableDirectCheckout",
  "createUnavailablePurchases",
  "createWebViewLocalKeyring",
  "decodeLocalKeyringSqliteKey",
  "decryptDocumentAttachmentBlob",
  "defaultContainerContentsPersistence",
  "defaultDocumentProjectorRegistry",
  "defaultDocumentsPersistence",
  "deletePersistedDocument",
  "deriveContainerSystemSlot",
  "deriveOrganizationMetadataContainerSystemSlot",
  "deriveOrganizationRosterProfileContainerSystemSlot",
  "deriveStoredDocumentTitle",
  "discardRegisteredDocumentLocalState",
  "encodeLocalKeyringSqliteKey",
  "enqueueReconciliationForEvents",
  "ensureDocumentAttachmentStructure",
  "fetchContainerKekLog",
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
  "importOrganizationUser",
  "initializeDocumentLinksSchema",
  "initializeStoredDocumentKind",
  "isPinCodeWrappedLocalSecretEnvelope",
  "isSystemContainerNode",
  "listBlobInfo",
  "listDocumentLinkedContainerIds",
  "loadContainerInfo",
  "loadContainerSyncWatermark",
  "loadDocumentAttributionRanges",
  "loadDocumentInfo",
  "loadLocalOrganizationDataUsage",
  "loadLocalOrganizationDirectoryAndGroups",
  "loadOrganizationBilling",
  "loadOrganizationBillingHistory",
  "loadOrganizationBillingManagementUrl",
  "localKeyringScopeKey",
  "moveRemoteContainer",
  "normalizeLocalKeyringScope",
  "openDocumentStore",
  "parseLocalKeyringManifest",
  "persistRegistrationBootstrap",
  "persistedDocumentCreateStateFromResponse",
  "projectStoredDocumentState",
  "purgeOpfsBlobStore",
  "readBlobByteSource",
  "readOrganizationProfileName",
  "readStoredDocumentState",
  "readStringDocumentField",
  "rebuildKeyringEntriesFromLog",
  "reconcileOrganizationDataUsage",
  "reconcileOrganizationDirectoryAndGroups",
  "recoverKeyringEntryFromWraps",
  "registerIdentity",
  "rekeyRemoteContainer",
  "removeOrganizationGroupUser",
  "replaceDocumentLinks",
  "requestAllDomainSyncLanes",
  "requestContainerContentsDocumentPriming",
  "requestDomainDocumentSync",
  "resolveOpIdAttribution",
  "resolveOrganizationBillingView",
  "revokeOrganizationContainerGrant",
  "revokeRemoteContainer",
  "rootContainerWriterProjectionFromCreatePlan",
  "sameDocumentAttachments",
  "saveContainerSyncWatermark",
  "serializeLocalKeyringManifest",
  "shareRemoteContainer",
  "shareRemoteContainerWithGroup",
  "startOrganizationTrial",
  "subscribeOrganizationReadModelInvalidation",
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
