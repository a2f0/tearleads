import type {
  ListDocumentAttachmentsResponse,
  ReferencedPrincipalStateResponse,
} from "@tearleads/validators/response";
import type { BlobBytes, BlobStore } from "../../data/blobContracts";
import {
  type DocumentProjectorRegistry,
  defaultDocumentProjectorRegistry,
} from "../../data/documents/documentKinds";
import type { DomainScope } from "../../data/domainScope";
import {
  type DocumentAttachmentHydrationRuntime,
  hydrateDocumentAttachmentBlobsFromRuntime,
} from "../blobs/hydrate";
import {
  type DocumentAttachmentUploadRuntime,
  uploadDocumentAttachmentFromRuntime,
} from "../blobs/upload";
import { resolveDocumentCreateAuthor } from "./author";
import { createRemoteDocumentFromRuntime } from "./create";
import {
  deleteLocalDocumentAttachmentFromRuntime,
  deletePendingDocumentAttachmentFromRuntime,
  deletePersistedDocumentFromRuntime,
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
    documentProjectors?: DocumentProjectorRegistry | undefined;
    domainScope: DomainScope;
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

type NormalizedDocumentsWorkflowRuntimeInput = Omit<
  DocumentsWorkflowRuntimeInput,
  "documentProjectors"
> & {
  documentProjectors: DocumentProjectorRegistry;
};

type CreateRemoteDocumentInput = Omit<
  Parameters<typeof createRemoteDocumentFromRuntime>[0],
  "runtime"
>;
type DeletePendingDocumentAttachmentInput = Omit<
  Parameters<typeof deletePendingDocumentAttachmentFromRuntime>[0],
  "runtime"
>;
type DeleteLocalDocumentAttachmentInput = Omit<
  Parameters<typeof deleteLocalDocumentAttachmentFromRuntime>[0],
  "runtime"
>;
type DeletePersistedDocumentInput = Omit<
  Parameters<typeof deletePersistedDocumentFromRuntime>[0],
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
  readonly documentProjectors: DocumentProjectorRegistry;
  readonly domainScope: DomainScope;
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
  deleteBlobBytes: (storageKey: string) => Promise<void>;
  deleteLocalAttachment: (
    input: DeleteLocalDocumentAttachmentInput,
  ) => ReturnType<typeof deleteLocalDocumentAttachmentFromRuntime>;
  deleteDocument: (
    input: DeletePersistedDocumentInput,
  ) => ReturnType<typeof deletePersistedDocumentFromRuntime>;
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
  | "documentProjectors"
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
  NormalizedDocumentsWorkflowRuntimeInput
>();

function lookupDocumentsWorkflowRuntimeInput(
  runtime: DocumentsWorkflowRuntime,
): NormalizedDocumentsWorkflowRuntimeInput | null {
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

function createDocumentsPersistenceRuntimeActions(
  input: NormalizedDocumentsWorkflowRuntimeInput,
): Pick<
  DocumentsWorkflowRuntimeActions,
  | "deleteLocalAttachment"
  | "deleteDocument"
  | "deletePendingAttachment"
  | "enqueuePendingUpdate"
  | "listPendingUpdates"
  | "loadPersistedStoreState"
  | "persistState"
  | "saveLocalAttachments"
  | "savePendingAttachment"
> {
  return {
    deleteLocalAttachment(deleteInput) {
      return deleteLocalDocumentAttachmentFromRuntime({
        ...deleteInput,
        runtime: input,
      });
    },
    deleteDocument(deleteInput) {
      return deletePersistedDocumentFromRuntime({
        ...deleteInput,
        runtime: input,
      });
    },
    deletePendingAttachment(deleteInput) {
      return deletePendingDocumentAttachmentFromRuntime({
        ...deleteInput,
        runtime: input,
      });
    },
    enqueuePendingUpdate(updateInput) {
      return enqueuePendingDocumentUpdateFromRuntime({
        ...updateInput,
        runtime: input,
      });
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
  };
}

function createDocumentsWorkflowRuntimeActions(
  input: NormalizedDocumentsWorkflowRuntimeInput,
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
    deleteBlobBytes(storageKey) {
      return input.blobStore.deleteBytes(storageKey);
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
    hydrateAttachmentBlobs(hydrateInput) {
      return hydrateDocumentAttachmentBlobsFromRuntime({
        ...hydrateInput,
        runtime: input,
      });
    },
    listDocumentAttachments(documentId) {
      return input.apiClient.listDocumentAttachments(documentId);
    },
    readBlobBytes(storageKey) {
      return input.blobStore.readBytes(storageKey);
    },
    resolveCreateAuthor() {
      return resolveDocumentCreateAuthor(input);
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
    ...createDocumentsPersistenceRuntimeActions(input),
  };
}

export function createDocumentsWorkflowRuntime(
  input: DocumentsWorkflowRuntimeInput,
): DocumentsWorkflowRuntime {
  const normalizedInput: NormalizedDocumentsWorkflowRuntimeInput = {
    ...input,
    documentProjectors:
      input.documentProjectors ?? defaultDocumentProjectorRegistry,
  };
  const runtime: DocumentsWorkflowRuntime = {
    containerId: normalizedInput.containerId,
    dbStatus: normalizedInput.dbStatus,
    documentProjectors: normalizedInput.documentProjectors,
    domainScope: normalizedInput.domainScope,
    encapsulationKeyPair: normalizedInput.encapsulationKeyPair,
    events: normalizedInput.events,
    isAuthenticated: normalizedInput.isAuthenticated,
    log: normalizedInput.log,
    online: normalizedInput.online,
    organizationId: normalizedInput.organizationId,
    signingFingerprint: normalizedInput.signingFingerprint,
    signingKeyPair: normalizedInput.signingKeyPair,
    userId: normalizedInput.userId,
    ...createDocumentsWorkflowRuntimeActions(normalizedInput),
  };
  documentsWorkflowRuntimeInputs.set(runtime, normalizedInput);

  return runtime;
}
