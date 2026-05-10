import type {
  ListDocumentAttachmentsResponse,
  ReferencedPrincipalStateResponse,
} from "@tearleads/validators/response";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
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

const documentsWorkflowRuntimeExecSql = Symbol(
  "documentsWorkflowRuntimeExecSql",
);

export interface DocumentsWorkflowRuntime {
  readonly [documentsWorkflowRuntimeExecSql]: ExecSql;
  readonly apiClient: DocumentsWorkflowRuntimeInput["apiClient"];
  readonly blobStore: BlobStore;
  readonly cacheReferencedPrincipalPolicies: (
    references: ReadonlyArray<ReferencedPrincipalStateResponse> | undefined,
  ) => Promise<void>;
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
  | typeof documentsWorkflowRuntimeExecSql
  | "apiClient"
  | "blobStore"
  | "cacheReferencedPrincipalPolicies"
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

function runtimeInputFromWorkflowRuntime(
  runtime: DocumentsWorkflowRuntime,
): DocumentsWorkflowRuntimeInput {
  return {
    apiClient: runtime.apiClient,
    blobStore: runtime.blobStore,
    cacheReferencedPrincipalPolicies: runtime.cacheReferencedPrincipalPolicies,
    containerId: runtime.containerId ?? null,
    dbStatus: runtime.dbStatus,
    domainScope: runtime.domainScope,
    encapsulationKeyPair: runtime.encapsulationKeyPair ?? null,
    events: runtime.events,
    execSql: runtime[documentsWorkflowRuntimeExecSql],
    isAuthenticated: runtime.isAuthenticated,
    log: runtime.log,
    online: runtime.online,
    organizationId: runtime.organizationId ?? null,
    signingFingerprint: runtime.signingFingerprint ?? null,
    signingKeyPair: runtime.signingKeyPair ?? null,
    userId: runtime.userId ?? null,
  };
}

function documentSyncPrerequisites(runtime: DocumentsWorkflowRuntime) {
  return {
    encapsulationKeyPair: runtime.encapsulationKeyPair,
    isAuthenticated: runtime.isAuthenticated,
    online: runtime.online,
  };
}

function documentProjectionRuntime(runtime: DocumentsWorkflowRuntime) {
  return {
    apiClient: runtime.apiClient,
    encapsulationKeyPair: runtime.encapsulationKeyPair ?? null,
    signingFingerprint: runtime.signingFingerprint ?? null,
    signingKeyPair: runtime.signingKeyPair ?? null,
    userId: runtime.userId ?? null,
  };
}

function createDocumentsWorkflowRuntimeActions(): DocumentsWorkflowRuntimeActions {
  return {
    createRemoteDocument(this: DocumentsWorkflowRuntime, createInput) {
      return createRemoteDocumentFromRuntime({
        ...createInput,
        runtime: runtimeInputFromWorkflowRuntime(this),
      });
    },
    createProjectionUserKeyResolver(this: DocumentsWorkflowRuntime) {
      return createDocumentProjectionUserKeyResolver(
        documentProjectionRuntime(this),
      );
    },
    deletePendingAttachment(this: DocumentsWorkflowRuntime, deleteInput) {
      return deletePendingDocumentAttachmentFromRuntime({
        ...deleteInput,
        runtime: runtimeInputFromWorkflowRuntime(this),
      });
    },
    didProjectionKeyRuntimeChange(
      this: DocumentsWorkflowRuntime,
      previousRuntime,
    ) {
      return didDocumentProjectionKeyRuntimeChange(
        documentProjectionRuntime(previousRuntime),
        documentProjectionRuntime(this),
      );
    },
    didRegainSyncPrerequisites(
      this: DocumentsWorkflowRuntime,
      previousRuntime,
    ) {
      return didRegainDocumentSyncPrerequisites(
        documentSyncPrerequisites(previousRuntime),
        documentSyncPrerequisites(this),
      );
    },
    enqueuePendingUpdate(this: DocumentsWorkflowRuntime, updateInput) {
      return enqueuePendingDocumentUpdateFromRuntime({
        ...updateInput,
        runtime: runtimeInputFromWorkflowRuntime(this),
      });
    },
    hydrateAttachmentBlobs(this: DocumentsWorkflowRuntime, hydrateInput) {
      return hydrateDocumentAttachmentBlobsFromRuntime({
        ...hydrateInput,
        runtime: runtimeInputFromWorkflowRuntime(this),
      });
    },
    listDocumentAttachments(this: DocumentsWorkflowRuntime, documentId) {
      return this.apiClient.listDocumentAttachments(documentId);
    },
    listPendingUpdates(this: DocumentsWorkflowRuntime, listInput) {
      return listPendingDocumentUpdatesFromRuntime({
        ...listInput,
        runtime: runtimeInputFromWorkflowRuntime(this),
      });
    },
    loadPersistedStoreState(this: DocumentsWorkflowRuntime, loadInput) {
      return loadPersistedDocumentStoreStateFromRuntime({
        ...loadInput,
        runtime: runtimeInputFromWorkflowRuntime(this),
      });
    },
    persistState(this: DocumentsWorkflowRuntime, persistInput) {
      return persistDocumentStateFromRuntime({
        ...persistInput,
        runtime: runtimeInputFromWorkflowRuntime(this),
      });
    },
    readBlobBytes(this: DocumentsWorkflowRuntime, storageKey) {
      return this.blobStore.readBytes(storageKey);
    },
    resolveCreateAuthor(this: DocumentsWorkflowRuntime) {
      return resolveDocumentCreateAuthor(runtimeInputFromWorkflowRuntime(this));
    },
    saveLocalAttachments(this: DocumentsWorkflowRuntime, saveInput) {
      return saveLocalDocumentAttachmentsFromRuntime({
        ...saveInput,
        runtime: runtimeInputFromWorkflowRuntime(this),
      });
    },
    savePendingAttachment(this: DocumentsWorkflowRuntime, saveInput) {
      return savePendingDocumentAttachmentFromRuntime({
        ...saveInput,
        runtime: runtimeInputFromWorkflowRuntime(this),
      });
    },
    syncRemoteDocument(this: DocumentsWorkflowRuntime, syncInput) {
      return syncRemoteDocumentFromRuntime({
        ...syncInput,
        runtime: runtimeInputFromWorkflowRuntime(this),
      });
    },
    uploadAttachment(this: DocumentsWorkflowRuntime, uploadInput) {
      return uploadDocumentAttachmentFromRuntime({
        ...uploadInput,
        runtime: runtimeInputFromWorkflowRuntime(this),
      });
    },
    writeBlobBytes(this: DocumentsWorkflowRuntime, storageKey, bytes) {
      return this.blobStore.writeBytes(storageKey, bytes);
    },
  };
}

export function createDocumentsWorkflowRuntime(
  input: DocumentsWorkflowRuntimeInput,
): DocumentsWorkflowRuntime {
  const runtime: DocumentsWorkflowRuntime = {
    [documentsWorkflowRuntimeExecSql]: input.execSql,
    apiClient: input.apiClient,
    blobStore: input.blobStore,
    cacheReferencedPrincipalPolicies: input.cacheReferencedPrincipalPolicies,
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
    ...createDocumentsWorkflowRuntimeActions(),
  };

  return runtime;
}
