export {
  unwrapContainerKekPath,
  unwrapDocumentContentKeyTarget,
} from "../../data/documents/shared/projection";
export { persistedDocumentCreateStateFromResponse } from "../../data/documents/shared/responses";
export {
  type DocumentSyncPullContinuation,
  readPullContinuation,
} from "../../data/documents/shared/syncPagination";
export type {
  DocumentCreateAuthor,
  DocumentLinkSetFailureHandler,
  DocumentLinkSetMutationFailure,
  RelinkRemoteDocumentResult,
} from "../../data/documents/shared/types";
export {
  DOCUMENT_HISTORY_COMPACTION_MAX_BYTES,
  DOCUMENT_HISTORY_COMPACTION_MAX_ROWS,
} from "../../data/sqlite/documentHistoryPersistence";
export {
  clearDocumentSyncFailure,
  recordDocumentSyncFailure,
} from "../../data/sqlite/documentPersistence";
export type { ExecSql } from "../../data/sqlite/sqlSchema";
export { selectDocumentSyncOutgoingBatch } from "../../data/sync/documentSyncOutgoingBatch";
export { settleOutgoingPassAndDecideReArm } from "../../data/sync/outgoingUpdateSettlement";
export {
  didRegainSyncPrerequisites,
  isDatabaseUnavailableError,
} from "../../data/sync/syncCoordinator";
export {
  deleteLocalDocumentAttachment,
  deletePendingDocumentAttachment,
  markLocalDocumentAttachmentDetached,
  saveLocalDocumentAttachments,
  savePendingDocumentAttachment,
} from "./attachmentPersistence";
export { resolveDocumentCreateAuthor } from "./author";
export { runSerializedDocumentBlobMutation } from "./blobMutationLock";
export {
  buildMaterializedDocumentCreatePlan,
  createRemoteDocument,
  documentWriterProjectionFromCreateResponse,
} from "./create";
export {
  importDocumentHistoryTailUpdates,
  loadPersistedDocumentContent,
} from "./historyContent";
export { buildMaterializedDocumentLinkSetMutationPlan } from "./linkSet";
export { relinkRemoteDocument } from "./linkSetRemote";
export { reclaimDocumentOrphanBlobs } from "./orphanBlobReclaims";
export {
  type DiscardedDocumentShellResult,
  deletePersistedDocument,
  discardPersistedDocumentToShell,
} from "./persistedDocumentRemoval";
export {
  DOCUMENTS_APP_KIND,
  type DocumentRecord,
  type DocumentsPersistence,
  defaultDocumentsPersistence,
  enqueuePendingDocumentUpdate,
  type LocalAttachmentRecord,
  listPendingDocumentUpdates,
  loadPersistedDocumentStoreState,
  type PendingAttachmentRecord,
  type PendingAttachmentUploadIdentity,
  type PendingUpdateInsert,
  type PendingUpdateRecord,
  persistDocumentState,
  type RelinkPersistedDocumentInput,
  runSerializedSqlMutation,
} from "./persistence";
export {
  createDocumentProjectionUserKeyResolver,
  type DocumentProjectionKeyRuntime,
  type DocumentProjectionUserKeyResolver,
  didDocumentProjectionKeyRuntimeChange,
} from "./projectionKeys";
export type { SyncRemoteDocumentInput } from "./readOnlySync";
export {
  createDocumentsWorkflowRuntime,
  type DocumentsWorkflowRuntime,
  type DocumentsWorkflowRuntimeGroups,
  type DocumentsWorkflowRuntimeInfra,
  type DocumentsWorkflowRuntimeInput,
  type DocumentsWorkflowRuntimeInputGroups,
} from "./runtime";
export {
  hasDocumentUpdateEvent,
  syncRemoteDocument,
} from "./sync";
export {
  describeDocumentRevalidationFailure,
  describeDocumentSyncSubmitFailure,
  type TerminalSubmitFailureHandler,
} from "./syncFailureClassification";
export { shouldClearDocumentSyncFailureAfterPass } from "./syncFailureClearance";
export {
  type DocumentSyncLane,
  registerDocumentSyncLane,
} from "./syncLane";
export type { RekeyPendingUpdate } from "./syncRecoveryRekey";
export {
  DOCUMENT_SYNC_TRACE_FRAGMENT,
  DOCUMENT_SYNC_TRACE_PATTERN,
} from "./syncTrace";
export { createDocumentWriterPublicKeyResolver } from "./writerKeys";
