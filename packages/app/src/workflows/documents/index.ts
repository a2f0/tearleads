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
export { resolveDocumentCreateAuthor } from "./author";
export {
  buildMaterializedDocumentCreatePlan,
  createRemoteDocument,
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
  deletePendingDocumentAttachment,
  deriveDocumentKind,
  deriveDocumentTitle,
  enqueuePendingDocumentUpdate,
  type LocalAttachmentRecord,
  listPendingDocumentUpdates,
  loadPersistedDocumentStoreState,
  type PendingAttachmentRecord,
  type PendingUpdateRecord,
  persistDocumentState,
  type RelinkPersistedDocumentInput,
  saveLocalDocumentAttachments,
  savePendingDocumentAttachment,
} from "./persistence";
export { syncRemoteDocument } from "./sync";
export { createDocumentWriterPublicKeyResolver } from "./writerKeys";
