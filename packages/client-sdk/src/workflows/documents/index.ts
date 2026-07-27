export {
  unwrapContainerKekPath,
  unwrapDocumentContentKeyTarget,
} from "../../data/documents/shared/projection";
export { persistedDocumentCreateStateFromResponse } from "../../data/documents/shared/responses";
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
export {
  buildMaterializedDocumentCreatePlan,
  createRemoteDocument,
  documentWriterProjectionFromCreateResponse,
} from "./create";
export {
  importDocumentHistoryTailUpdates,
  loadPersistedDocumentContent,
} from "./historyContent";
export {
  buildMaterializedDocumentLinkSetMutationPlan,
  relinkRemoteDocument,
} from "./linkSet";
export {
  type DiscardedDocumentShellResult,
  DOCUMENTS_APP_KIND,
  type DocumentRecord,
  type DocumentsPersistence,
  defaultDocumentsPersistence,
  deletePersistedDocument,
  discardPersistedDocumentToShell,
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
export {
  createDocumentsWorkflowRuntime,
  type DocumentsWorkflowRuntime,
  type DocumentsWorkflowRuntimeAuth,
  type DocumentsWorkflowRuntimeCrypto,
  type DocumentsWorkflowRuntimeGroups,
  type DocumentsWorkflowRuntimeInfra,
  type DocumentsWorkflowRuntimeInput,
  type DocumentsWorkflowRuntimeInputGroups,
  type DocumentsWorkflowRuntimeState,
  type DocumentsWorkflowRuntimeUtil,
} from "./runtime";
export {
  hasDocumentUpdateEvent,
  syncRemoteDocument,
} from "./sync";
export {
  describeDocumentSyncSubmitFailure,
  type TerminalSubmitFailureHandler,
} from "./syncFailures";
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
