export {
  buildMaterializedDocumentCreatePlan,
  createRemoteDocument,
} from "./actions/create";
export {
  assertDocumentWriterProjectionConsistent,
  buildMaterializedDocumentLinkSetMutationPlan,
  relinkRemoteDocument,
} from "./actions/linkSet";
export { syncRemoteDocument } from "./actions/sync";
export {
  unwrapContainerKekPath,
  unwrapDocumentContentKeyTarget,
} from "./shared/projection";
export { persistedDocumentCreateStateFromResponse } from "./shared/responses";
export type {
  DocumentCreateAuthor,
  ProjectionVerificationOptions,
  RelinkRemoteDocumentResult,
} from "./shared/types";
export { projectionVerificationOptions } from "./shared/types";
