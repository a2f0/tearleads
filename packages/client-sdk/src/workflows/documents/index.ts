export {
  unwrapContainerKekPath,
  unwrapDocumentContentKeyTarget,
} from "../../data/documents/shared/projection";
export { persistedDocumentCreateStateFromResponse } from "../../data/documents/shared/responses";
export type {
  DocumentCreateAuthor,
  RelinkRemoteDocumentResult,
} from "../../data/documents/shared/types";
export { resolveDocumentCreateAuthor } from "./author";
export {
  buildMaterializedDocumentCreatePlan,
  createRemoteDocument,
  type RemoteDocumentCreateRuntime,
} from "./create";
export {
  buildMaterializedDocumentLinkSetMutationPlan,
  relinkRemoteDocument,
} from "./linkSet";
export {
  DOCUMENTS_APP_KIND,
  type DocumentRecord,
  type DocumentsPersistence,
  defaultDocumentsPersistence,
  type LocalAttachmentRecord,
  loadPersistedDocumentStoreStateFromRuntime,
  type PendingAttachmentRecord,
  type PendingUpdateInsert,
  type PendingUpdateRecord,
  type RelinkPersistedDocumentInput,
  savePendingDocumentAttachmentFromRuntime,
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
} from "./runtime";
export {
  hasDocumentUpdateEvent,
  syncRemoteDocument,
} from "./sync";
export {
  type DocumentSyncLane,
  isDestroyedDocumentSyncRuntimeError,
  registerDocumentSyncLane,
} from "./syncLane";
export { createDocumentWriterPublicKeyResolver } from "./writerKeys";
