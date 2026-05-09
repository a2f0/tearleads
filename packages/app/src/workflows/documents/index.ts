export {
  assertDocumentWriterProjectionConsistent,
  unwrapContainerKekPath,
  unwrapDocumentContentKeyTarget,
} from "../../data/documents/shared/projection";
export { persistedDocumentCreateStateFromResponse } from "../../data/documents/shared/responses";
export type {
  DocumentCreateAuthor,
  ProjectionVerificationOptions,
  RelinkRemoteDocumentResult,
} from "../../data/documents/shared/types";
export { projectionVerificationOptions } from "../../data/documents/shared/types";
export {
  type DocumentAuthorRuntime,
  resolveDocumentCreateAuthor,
} from "./author";
export {
  buildMaterializedDocumentCreatePlan,
  createRemoteDocument,
  createRemoteDocumentFromRuntime,
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
  deletePendingDocumentAttachmentFromRuntime,
  deriveDocumentKind,
  deriveDocumentTitle,
  enqueuePendingDocumentUpdateFromRuntime,
  type LocalAttachmentRecord,
  listPendingDocumentUpdatesFromRuntime,
  loadPersistedDocumentStoreStateFromRuntime,
  type PendingAttachmentRecord,
  type PendingUpdateRecord,
  persistDocumentStateFromRuntime,
  type RelinkPersistedDocumentInput,
  saveLocalDocumentAttachmentsFromRuntime,
  savePendingDocumentAttachmentFromRuntime,
} from "./persistence";
export {
  createDocumentProjectionUserKeyResolver,
  type DocumentProjectionUserKeyResolver,
  didDocumentProjectionKeyRuntimeChange,
} from "./projectionKeys";
export {
  hasDocumentUpdateEvent,
  syncRemoteDocument,
  syncRemoteDocumentFromRuntime,
} from "./sync";
export {
  type DocumentSyncLane,
  didRegainDocumentSyncPrerequisites,
  isDestroyedDocumentSyncRuntimeError,
  registerDocumentSyncLane,
} from "./syncLane";
export { createDocumentWriterPublicKeyResolver } from "./writerKeys";
