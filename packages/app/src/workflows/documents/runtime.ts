import type {
  ListDocumentAttachmentsResponse,
  ReferencedPrincipalStateResponse,
} from "@tearleads/validators/response";
import {
  type DocumentAttachmentHydrationRuntime,
  hydrateDocumentAttachmentBlobsFromRuntime,
} from "../blobs/hydrate";
import type { BlobBytes, BlobStore } from "../blobs/storage";
import {
  type DocumentAttachmentUploadRuntime,
  uploadDocumentAttachmentFromRuntime,
} from "../blobs/upload";
import { resolveDocumentCreateAuthor } from "./author";
import { createRemoteDocumentFromRuntime } from "./create";
import {
  deletePendingDocumentAttachmentFromRuntime,
  enqueuePendingDocumentUpdateFromRuntime,
  listPendingDocumentUpdatesFromRuntime,
  loadPersistedDocumentStoreStateFromRuntime,
  persistDocumentStateFromRuntime,
  saveLocalDocumentAttachmentsFromRuntime,
  savePendingDocumentAttachmentFromRuntime,
} from "./persistence";
import {
  createDocumentProjectionUserKeyResolver,
  type DocumentProjectionUserKeyResolver,
  didDocumentProjectionKeyRuntimeChange,
} from "./projectionKeys";
import { syncRemoteDocumentFromRuntime } from "./sync";
import { didRegainDocumentSyncPrerequisites } from "./syncLane";

type DocumentsWorkflowRuntimeInput = DocumentAttachmentHydrationRuntime &
  DocumentAttachmentUploadRuntime &
  Parameters<typeof createRemoteDocumentFromRuntime>[0]["runtime"] &
  Parameters<typeof loadPersistedDocumentStoreStateFromRuntime>[0]["runtime"] &
  Parameters<typeof syncRemoteDocumentFromRuntime>[0]["runtime"] & {
    blobStore: BlobStore;
    cacheReferencedPrincipalPolicies: (
      references: ReadonlyArray<ReferencedPrincipalStateResponse> | undefined,
    ) => Promise<void>;
    dbStatus: string;
    domainScope: object;
    encapsulationKeyPair?:
      | {
          publicKey: Uint8Array;
          secretKey: Uint8Array;
        }
      | null
      | undefined;
    events: ReadonlyArray<unknown>;
    isAuthenticated: boolean;
    online: boolean;
  };

type CreateRemoteDocumentInput = Omit<
  Parameters<typeof createRemoteDocumentFromRuntime>[0],
  "runtime"
>;
type DeletePendingDocumentAttachmentInput = Omit<
  Parameters<typeof deletePendingDocumentAttachmentFromRuntime>[0],
  "runtime"
>;
type EnqueuePendingDocumentUpdateInput = Omit<
  Parameters<typeof enqueuePendingDocumentUpdateFromRuntime>[0],
  "runtime"
>;
type HydrateDocumentAttachmentBlobsInput = Omit<
  Parameters<typeof hydrateDocumentAttachmentBlobsFromRuntime>[0],
  "runtime"
>;
type LoadPersistedDocumentStoreStateInput = Omit<
  Parameters<typeof loadPersistedDocumentStoreStateFromRuntime>[0],
  "runtime"
>;
type PersistDocumentStateInput = Omit<
  Parameters<typeof persistDocumentStateFromRuntime>[0],
  "runtime"
>;
type SaveLocalDocumentAttachmentsInput = Omit<
  Parameters<typeof saveLocalDocumentAttachmentsFromRuntime>[0],
  "runtime"
>;
type SavePendingDocumentAttachmentInput = Omit<
  Parameters<typeof savePendingDocumentAttachmentFromRuntime>[0],
  "runtime"
>;
type SyncRemoteDocumentInput = Omit<
  Parameters<typeof syncRemoteDocumentFromRuntime>[0],
  "runtime"
>;
type UploadDocumentAttachmentInput = Omit<
  Parameters<typeof uploadDocumentAttachmentFromRuntime>[0],
  "runtime"
>;

export interface DocumentsWorkflowRuntime {
  readonly containerId?: string | null | undefined;
  readonly dbStatus: string;
  readonly domainScope: object;
  readonly encapsulationKeyPair?:
    | {
        publicKey: Uint8Array;
        secretKey: Uint8Array;
      }
    | null
    | undefined;
  readonly events: ReadonlyArray<unknown>;
  readonly isAuthenticated: boolean;
  readonly log: (message: string) => void;
  readonly online: boolean;
  readonly organizationId?: string | null | undefined;
  readonly signingFingerprint?: string | null | undefined;
  readonly signingKeyPair?:
    | {
        signingPrivateKey: Uint8Array;
        signingPublicKey: Uint8Array;
      }
    | null
    | undefined;
  readonly userId?: string | null | undefined;
  createRemoteDocument: (
    input: CreateRemoteDocumentInput,
  ) => ReturnType<typeof createRemoteDocumentFromRuntime>;
  createProjectionUserKeyResolver: () => DocumentProjectionUserKeyResolver;
  deletePendingAttachment: (
    input: DeletePendingDocumentAttachmentInput,
  ) => ReturnType<typeof deletePendingDocumentAttachmentFromRuntime>;
  didProjectionKeyRuntimeChange: (
    previousRuntime: DocumentsWorkflowRuntime,
  ) => boolean;
  didRegainSyncPrerequisites: (
    previousRuntime: DocumentsWorkflowRuntime,
  ) => boolean;
  enqueuePendingUpdate: (
    input: EnqueuePendingDocumentUpdateInput,
  ) => ReturnType<typeof enqueuePendingDocumentUpdateFromRuntime>;
  hydrateAttachmentBlobs: (
    input: HydrateDocumentAttachmentBlobsInput,
  ) => ReturnType<typeof hydrateDocumentAttachmentBlobsFromRuntime>;
  listDocumentAttachments: (
    documentId: string,
  ) => Promise<ListDocumentAttachmentsResponse | null>;
  listPendingUpdates: (
    input: Omit<
      Parameters<typeof listPendingDocumentUpdatesFromRuntime>[0],
      "runtime"
    >,
  ) => ReturnType<typeof listPendingDocumentUpdatesFromRuntime>;
  loadPersistedStoreState: (
    input: LoadPersistedDocumentStoreStateInput,
  ) => ReturnType<typeof loadPersistedDocumentStoreStateFromRuntime>;
  persistState: (
    input: PersistDocumentStateInput,
  ) => ReturnType<typeof persistDocumentStateFromRuntime>;
  readBlobBytes: (storageKey: string) => Promise<BlobBytes | null>;
  resolveCreateAuthor: () => ReturnType<typeof resolveDocumentCreateAuthor>;
  saveLocalAttachments: (
    input: SaveLocalDocumentAttachmentsInput,
  ) => ReturnType<typeof saveLocalDocumentAttachmentsFromRuntime>;
  savePendingAttachment: (
    input: SavePendingDocumentAttachmentInput,
  ) => ReturnType<typeof savePendingDocumentAttachmentFromRuntime>;
  syncRemoteDocument: (
    input: SyncRemoteDocumentInput,
  ) => ReturnType<typeof syncRemoteDocumentFromRuntime>;
  uploadAttachment: (
    input: UploadDocumentAttachmentInput,
  ) => ReturnType<typeof uploadDocumentAttachmentFromRuntime>;
  writeBlobBytes: (storageKey: string, bytes: BlobBytes) => Promise<void>;
}

type DocumentsWorkflowRuntimeActions = Omit<
  DocumentsWorkflowRuntime,
  | "containerId"
  | "dbStatus"
  | "domainScope"
  | "encapsulationKeyPair"
  | "events"
  | "isAuthenticated"
  | "log"
  | "online"
  | "organizationId"
  | "signingFingerprint"
  | "signingKeyPair"
  | "userId"
>;

const documentsWorkflowRuntimeInputs = new WeakMap<
  DocumentsWorkflowRuntime,
  DocumentsWorkflowRuntimeInput
>();

function lookupDocumentsWorkflowRuntimeInput(
  runtime: DocumentsWorkflowRuntime,
): DocumentsWorkflowRuntimeInput | null {
  return documentsWorkflowRuntimeInputs.get(runtime) ?? null;
}

function documentSyncPrerequisites(input: {
  encapsulationKeyPair?: unknown;
  isAuthenticated: boolean;
  online: boolean;
}) {
  return {
    encapsulationKeyPair: input.encapsulationKeyPair,
    isAuthenticated: input.isAuthenticated,
    online: input.online,
  };
}

function documentProjectionRuntime(input: DocumentsWorkflowRuntimeInput) {
  return {
    apiClient: input.apiClient,
    encapsulationKeyPair: input.encapsulationKeyPair ?? null,
    signingFingerprint: input.signingFingerprint ?? null,
    signingKeyPair: input.signingKeyPair ?? null,
    userId: input.userId ?? null,
  };
}

function createDocumentsWorkflowRuntimeActions(
  input: DocumentsWorkflowRuntimeInput,
): DocumentsWorkflowRuntimeActions {
  return {
    createRemoteDocument(createInput) {
      return createRemoteDocumentFromRuntime({
        ...createInput,
        runtime: input,
      });
    },
    createProjectionUserKeyResolver() {
      return createDocumentProjectionUserKeyResolver(
        documentProjectionRuntime(input),
      );
    },
    deletePendingAttachment(deleteInput) {
      return deletePendingDocumentAttachmentFromRuntime({
        ...deleteInput,
        runtime: input,
      });
    },
    didProjectionKeyRuntimeChange(previousRuntime) {
      const previousInput =
        lookupDocumentsWorkflowRuntimeInput(previousRuntime);
      if (!previousInput) {
        return true;
      }

      return didDocumentProjectionKeyRuntimeChange(
        documentProjectionRuntime(previousInput),
        documentProjectionRuntime(input),
      );
    },
    didRegainSyncPrerequisites(previousRuntime) {
      const previousInput =
        lookupDocumentsWorkflowRuntimeInput(previousRuntime);
      if (!previousInput) {
        return false;
      }

      return didRegainDocumentSyncPrerequisites(
        documentSyncPrerequisites(previousInput),
        documentSyncPrerequisites(input),
      );
    },
    enqueuePendingUpdate(updateInput) {
      return enqueuePendingDocumentUpdateFromRuntime({
        ...updateInput,
        runtime: input,
      });
    },
    hydrateAttachmentBlobs(hydrateInput) {
      return hydrateDocumentAttachmentBlobsFromRuntime({
        ...hydrateInput,
        runtime: input,
      });
    },
    listDocumentAttachments(documentId) {
      return input.apiClient.listDocumentAttachments(documentId);
    },
    listPendingUpdates(listInput) {
      return listPendingDocumentUpdatesFromRuntime({
        ...listInput,
        runtime: input,
      });
    },
    loadPersistedStoreState(loadInput) {
      return loadPersistedDocumentStoreStateFromRuntime({
        ...loadInput,
        runtime: input,
      });
    },
    persistState(persistInput) {
      return persistDocumentStateFromRuntime({
        ...persistInput,
        runtime: input,
      });
    },
    readBlobBytes(storageKey) {
      return input.blobStore.readBytes(storageKey);
    },
    resolveCreateAuthor() {
      return resolveDocumentCreateAuthor(input);
    },
    saveLocalAttachments(saveInput) {
      return saveLocalDocumentAttachmentsFromRuntime({
        ...saveInput,
        runtime: input,
      });
    },
    savePendingAttachment(saveInput) {
      return savePendingDocumentAttachmentFromRuntime({
        ...saveInput,
        runtime: input,
      });
    },
    syncRemoteDocument(syncInput) {
      return syncRemoteDocumentFromRuntime({
        ...syncInput,
        runtime: input,
      });
    },
    uploadAttachment(uploadInput) {
      return uploadDocumentAttachmentFromRuntime({
        ...uploadInput,
        runtime: input,
      });
    },
    writeBlobBytes(storageKey, bytes) {
      return input.blobStore.writeBytes(storageKey, bytes);
    },
  };
}

export function createDocumentsWorkflowRuntime(
  input: DocumentsWorkflowRuntimeInput,
): DocumentsWorkflowRuntime {
  const runtime: DocumentsWorkflowRuntime = {
    containerId: input.containerId,
    dbStatus: input.dbStatus,
    domainScope: input.domainScope,
    encapsulationKeyPair: input.encapsulationKeyPair,
    events: input.events,
    isAuthenticated: input.isAuthenticated,
    log: input.log,
    online: input.online,
    organizationId: input.organizationId,
    signingFingerprint: input.signingFingerprint,
    signingKeyPair: input.signingKeyPair,
    userId: input.userId,
    ...createDocumentsWorkflowRuntimeActions(input),
  };
  documentsWorkflowRuntimeInputs.set(runtime, input);

  return runtime;
}
