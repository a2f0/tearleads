// Refusals the SDK raises before it encrypts or sends a container-scoped
// write; hosts classify them with classifyContainerWriteRefusal.
export { ContainerAuthorAccessError } from "../../data/containers/shared/authorAccess";
// A create or move past the readable path length; `code` is
// `container_path_too_deep`. Queued moves are abandoned, queued creates wait.
export { ContainerPathTooDeepError } from "../../data/containers/shared/containerPathLimits";
export type { ContainerReciteApi } from "../../data/containers/shared/reciteApi";
export type {
  ContainerMutationAuthor,
  MaterializedContainerRekeyPlan,
} from "../../data/containers/shared/types";
export type {
  AggregatedContainerKekLog,
  KeyringRebuildResult,
} from "../../data/documents/shared/containerKek";
export {
  ContainerKekRepairInaccessibleError,
  ContainerKekRepairRequiredError,
  fetchContainerKekLog,
  HistoricalWrapUnavailableError,
  type HistoricalWrapUnavailableReason,
  rebuildKeyringEntriesFromLog,
  recoverKeyringEntryFromWraps,
} from "../../data/documents/shared/containerKek";
// A share's projection verification can be cancelled by a newer generation
// underneath the caller; hosts filter that outcome from their own reporting.
export { isProjectionVerificationCancelledError } from "../../data/keyingProjectionVerification/types";
export {
  buildContainerCreatePlan,
  buildMaterializedContainerCreatePlan,
  childContainerWriterProjectionFromCreatePlan,
  createRemoteContainer,
} from "./child/create";
export {
  type AppliedContainerMove,
  moveRemoteContainer,
  replayRemoteContainerMove,
} from "./child/move";
// Organizations' group shares submit and acknowledge their container mutation.
export {
  submitAcknowledgedContainerMutation,
  submitPlainContainerMutation,
} from "./child/mutationSubmit";
export { buildMaterializedContainerRekeyPlan } from "./child/rekey";
// A rebuilt keyring override that a concurrent rotation outdated: rebuild it.
export { ContainerKeyringOverrideStaleError } from "./child/rekey/keyringOverrideLineage";
export { containerWriterProjectionFromRekeyPlan } from "./child/rekey/rekeyProjection";
export { rekeyRemoteContainer } from "./child/rekey/rekeyRemote";
export {
  buildMaterializedContainerRevokePlan,
  revokeRemoteContainer,
} from "./child/revoke";
export { shareRemoteContainer } from "./child/share";
export { buildMaterializedContainerSharePlan } from "./child/share/shareMaterialization";
export { referencedPrincipalHeadFromPolicy } from "./child/share/sharePlanCore";
export { resolveShareProjection } from "./child/share/shareProjection";
export {
  signedContainerMetadataDocumentId,
  signedContainerReferencedPrincipalHeads,
} from "./mutationResponse";
export {
  buildRootContainerCreatePlan,
  rootContainerWriterProjectionFromCreatePlan,
} from "./root/create";
export {
  type ContainerWriteRefusal,
  classifyContainerWriteRefusal,
} from "./writeRefusal";
