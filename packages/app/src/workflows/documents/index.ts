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
  buildMaterializedDocumentCreatePlan,
  createRemoteDocument,
} from "./create";
export {
  buildMaterializedDocumentLinkSetMutationPlan,
  relinkRemoteDocument,
} from "./linkSet";
export { syncRemoteDocument } from "./sync";
