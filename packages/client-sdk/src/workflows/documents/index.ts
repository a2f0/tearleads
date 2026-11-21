export {
  unwrapContainerKekPath,
  unwrapDocumentContentKeyTarget,
} from "../../data/documents/shared/projection";
export { persistedDocumentCreateStateFromResponse } from "../../data/documents/shared/responses";
export { deriveStableDocumentId } from "../../data/documents/shared/stableDocumentId";
export { selectDocumentSyncOutgoingBatch } from "../../data/documents/shared/sync/documentSyncOutgoingBatch";
export type { SyncRemoteDocumentResult } from "../../data/documents/shared/sync/documentSyncTypes";
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
  CreateRemoteDocumentResult,
  DocumentCreateAuthor,
  DocumentLinkSetFailureHandler,
  DocumentLinkSetMutationFailure,
  DocumentRotationProofMode,
  RelinkRemoteDocumentResult,
} from "../../data/documents/shared/types";
export { DocumentRecordRepository } from "../../data/persistence/documents/records";
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
export { backfillDocumentAttachmentNames } from "./attachments/attachmentFilenameBackfill";
export {
  deletePendingDocumentAttachment,
  markLocalDocumentAttachmentDetached,
  saveLocalDocumentAttachments,
  savePendingDocumentAttachment,
  settleDocumentAttachmentRemovalMarker,
} from "./attachments/attachmentPersistence";
export { runSerializedDocumentBlobMutation } from "./attachments/blobMutationLock";
export { reclaimDocumentOrphanBlobs } from "./attachments/orphanBlobReclaims";
export { resolveDocumentCreateAuthor } from "./author";
export {
  buildMaterializedDocumentCreatePlan,
  documentWriterProjectionFromCreateResponse,
} from "./create";
export type { CreateRemoteDocumentRequest } from "./create/remoteDocumentCreateRequest";
export {
  type DocumentFoundingUpdate,
  readDocumentFoundingUpdate,
} from "./history/documentFoundingUpdate";
export {
  type DocumentHistory,
  type DocumentHistoryStop,
  type DocumentHistoryVersion,
  type DocumentHistoryVersionEntry,
  type DocumentHistoryView,
  openDocumentHistory,
} from "./history/documentHistory";
export {
  type DocumentHistoryChange,
  type DocumentHistoryRowChange,
  type DocumentHistoryTextChange,
  isEmptyDocumentHistoryChange,
} from "./history/documentHistoryChange";
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
export {
  enqueuePendingDocumentUpdate,
  listPendingDocumentUpdates,
} from "./pendingUpdatePersistence";
export {
  type AttachmentRemovalMarkerObservation,
  type AttachmentRemovalMarkerSettlement,
  type AttachmentRemovalRows,
  type AttachmentStagingRows,
  DOCUMENTS_APP_KIND,
  type DocumentBirthResult,
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
  type QueuedPendingUpdateRecord,
  type RelinkPersistedDocumentInput,
  runSerializedSqlMutation,
  type SettleAttachmentRemovalMarkerInput,
} from "./persistence";
export {
  createDocumentProjectionUserKeyResolver,
  type DocumentProjectionKeyRuntime,
  type DocumentProjectionUserKeyResolver,
  didDocumentProjectionKeyRuntimeChange,
} from "./projectionKeys";
export { buildDocumentPurgeRequest } from "./purge";
export {
  type DiscardedDocumentShellResult,
  deletePersistedDocument,
  discardPersistedDocumentToShell,
} from "./purge/persistedDocumentRemoval";
export type { RemoteDocumentServiceApi } from "./remote/remoteDocumentCollaborators";
export { RemoteDocumentService } from "./remote/remoteDocumentService";
export {
  createDocumentsWorkflowRuntime,
  createDocumentsWorkflowRuntimeFromSnapshot,
  type DocumentsWorkflowRuntime,
  type DocumentsWorkflowRuntimeGroups,
  type DocumentsWorkflowRuntimeInfra,
  type DocumentsWorkflowRuntimeInput,
  type DocumentsWorkflowRuntimeInputGroups,
  type DocumentsWorkflowRuntimeSnapshot,
} from "./runtime";
export { documentCreateSeedCandidate } from "./sync/initialSync";
export type { SyncRemoteDocumentRequest } from "./sync/remoteDocumentSyncPass";
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
