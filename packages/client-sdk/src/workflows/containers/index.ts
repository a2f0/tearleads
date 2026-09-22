// Refusals the SDK raises before it encrypts or sends a container-scoped
// write; hosts classify them with classifyContainerWriteRefusal.
export { ContainerAuthorAccessError } from "../../data/containers/shared/authorAccess";
export type { ContainerReciteApi } from "../../data/containers/shared/reciteApi";
export type {
  ContainerMutationAuthor,
  MaterializedContainerRekeyPlan,
} from "../../data/containers/shared/types";
export {
  ContainerKekRepairInaccessibleError,
  ContainerKekRepairRequiredError,
} from "../../data/documents/shared/containerKekCurrency";
export type {
  AggregatedContainerKekLog,
  KeyringRebuildResult,
} from "../../data/documents/shared/keyringRebuild";
export {
  fetchContainerKekLog,
  HistoricalWrapUnavailableError,
  type HistoricalWrapUnavailableReason,
  rebuildKeyringEntriesFromLog,
  recoverKeyringEntryFromWraps,
} from "../../data/documents/shared/keyringRebuild";
// A share's projection verification can be cancelled by a newer generation
// underneath the caller; hosts filter that outcome from their own reporting.
export { isProjectionVerificationCancelledError } from "../../data/keyingProjectionVerification/types";
export {
  buildContainerCreatePlan,
  buildMaterializedContainerCreatePlan,
  childContainerWriterProjectionFromCreatePlan,
  createRemoteContainer,
} from "./child/create";
export { moveRemoteContainer } from "./child/move";
export { buildMaterializedContainerRekeyPlan } from "./child/rekey";
export { containerWriterProjectionFromRekeyPlan } from "./child/rekeyProjection";
export { rekeyRemoteContainer } from "./child/rekeyRemote";
export {
  buildMaterializedContainerRevokePlan,
  revokeRemoteContainer,
} from "./child/revoke";
export {
  shareRemoteContainer,
  shareRemoteContainerWithGroup,
} from "./child/share";
export { buildMaterializedContainerSharePlan } from "./child/shareMaterialization";
export { referencedPrincipalHeadFromPolicy } from "./child/sharePlanCore";
export {
  advanceVerifiedSharePolicies,
  GroupShareNameMismatchError,
  loadVerifiedGroupSharePrincipalPolicy,
  type VerifiedSharePrincipalPolicy,
} from "./child/sharePrincipalPolicy";
export {
  readContainerMutationMetadataDocumentId,
  referencedPrincipalHeadsFromContainerMutationResponse,
} from "./mutationResponse";
export {
  buildRootContainerCreatePlan,
  rootContainerWriterProjectionFromCreatePlan,
} from "./root/create";
export {
  type ContainerWriteRefusal,
  classifyContainerWriteRefusal,
} from "./writeRefusal";
