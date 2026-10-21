// The container KEK path operations other subsystems use. Container Data
// creates, moves, rotates, and shares containers and rebuilds their keyrings
// through them; blob attachments check that a document's KEK paths are current.
export {
  assertContainerKekPathCurrent,
  assertDocumentKekPathsCurrent,
  ContainerKekRepairInaccessibleError,
  ContainerKekRepairRequiredError,
} from "./containerKekCurrency";
export { verifyContainerKekEntries } from "./containerKekEntryVerification";
export {
  ContainerKekTargetUnreachableError,
  unwrapContainerKekPath,
} from "./containerKekPath";
export { signedHistoryEpochIds } from "./containerKekPathHistory";
export {
  type AggregatedContainerKekLog,
  fetchContainerKekLog,
  HistoricalWrapUnavailableError,
  type HistoricalWrapUnavailableReason,
  type KeyringRebuildResult,
  rebuildKeyringEntriesFromLog,
  recoverKeyringEntryFromWraps,
} from "./keyringRebuild";
