export {
  unwrapContainerKekPath,
  unwrapDocumentContentKeyTarget,
} from "../../data/documents/shared/projection";
export { persistedDocumentCreateStateFromResponse } from "../../data/documents/shared/responses";
export { selectDocumentSyncOutgoingBatch } from "../../data/documents/shared/sync/documentSyncOutgoingBatch";
export {
  type DocumentSyncUpdateIsolationError,
  type IncomingDocumentSyncUpdateValidator,
  isDocumentSyncUpdateIsolationError,
  validateDocumentSyncUpdateImports,
} from "../../data/documents/shared/sync/documentSyncUpdateIsolation";
export {
  type DocumentSyncPullContinuation,
  documentSyncPullContinuationsEqual,
  readPullContinuation,
} from "../../data/documents/shared/sync/syncPagination";
export type {
  DocumentCreateAuthor,
  DocumentLinkSetFailureHandler,
  DocumentLinkSetMutationFailure,
  RelinkRemoteDocumentResult,
} from "../../data/documents/shared/types";
export {
  clearDocumentSyncFailure,
  invalidateDocumentSyncPullContinuation,
  recordDocumentSyncFailure,
} from "../../data/persistence/documents/records";
export {
  DOCUMENT_HISTORY_COMPACTION_MAX_BYTES,
  DOCUMENT_HISTORY_COMPACTION_MAX_ROWS,
} from "../../data/persistence/documents/records/documentHistoryPersistence";
export type { ExecSql } from "../../data/sqlite/sqlSchema";
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
} from "./attachments/attachmentPersistence";
export { runSerializedDocumentBlobMutation } from "./attachments/blobMutationLock";
export { reclaimDocumentOrphanBlobs } from "./attachments/orphanBlobReclaims";
export { resolveDocumentCreateAuthor } from "./author";
export {
  buildMaterializedDocumentCreatePlan,
  createRemoteDocument,
  documentWriterProjectionFromCreateResponse,
} from "./create";
export {
  importDocumentHistoryTailUpdates,
  loadPersistedDocumentContent,
  mergePersistedDocumentHistory,
} from "./historyContent";
export { buildMaterializedDocumentLinkSetMutationPlan } from "./linkSet";
export {
  createLinkSetAttachmentReuse,
  type LinkSetAttachmentReuse,
} from "./linkSet/linkSetBlobRewraps";
export { relinkRemoteDocument } from "./linkSet/linkSetRemote";
export {
  enqueuePendingDocumentUpdate,
  listPendingDocumentUpdates,
} from "./pendingUpdatePersistence";
export {
  type AttachmentRemovalRows,
  type AttachmentStagingRows,
  DOCUMENTS_APP_KIND,
  type DocumentRecord,
  type DocumentsPersistence,
  defaultDocumentsPersistence,
  type LocalAttachmentRecord,
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
export {
  buildDocumentPurgeRequest,
  purgeRemoteDocument,
} from "./purge";
export {
  type DiscardedDocumentShellResult,
  deletePersistedDocument,
  discardPersistedDocumentToShell,
} from "./purge/persistedDocumentRemoval";
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
export { documentCreateSeedCandidate } from "./sync/initialSync";
export type { SyncRemoteDocumentInput } from "./sync/readOnlySync";
export type { DocumentSyncContainerRekeyBuilder } from "./sync/syncAttemptState";
export {
  type DocumentSyncLane,
  registerDocumentSyncLane,
  requestDocumentSyncLaneAndWait,
} from "./sync/syncLane";
export {
  DOCUMENT_SYNC_TRACE_FRAGMENT,
  DOCUMENT_SYNC_TRACE_PATTERN,
} from "./sync/syncTrace";
export {
  describeDocumentRevalidationFailure,
  describeDocumentSyncSubmitFailure,
  type TerminalSubmitFailureHandler,
} from "./syncFailures/syncFailureClassification";
export { shouldClearDocumentSyncFailureAfterPass } from "./syncFailures/syncFailureClearance";
export { DocumentRawHistoryUnavailableError } from "./syncPlan/syncContentKeys";
export type { RekeyPendingUpdate } from "./syncRekeys/syncRecoveryRekey";
export { createDocumentWriterPublicKeyResolver } from "./writerKeys";
