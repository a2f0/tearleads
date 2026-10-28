import { ACKNOWLEDGEMENT_NEGATIVE_CONTROLS } from "./protocolAcknowledgementNegativeControls";
import { ANCESTOR_RECOVERY_NEGATIVE_CONTROLS } from "./protocolAncestorRecoveryNegativeControls";
import { ATTACHMENT_NEGATIVE_CONTROLS } from "./protocolAttachmentNegativeControls";
import { BASELINE_DOMINANCE_NEGATIVE_CONTROLS } from "./protocolBaselineDominanceNegativeControls";
import { CONTAINER_ADOPTION_NEGATIVE_CONTROLS } from "./protocolContainerAdoptionNegativeControls";
import { CONTAINER_DEPTH_NEGATIVE_CONTROLS } from "./protocolContainerDepthNegativeControls";
import { CONTAINER_GRANT_SCOPE_NEGATIVE_CONTROLS } from "./protocolContainerGrantScopeNegativeControls";
import { CONTAINER_INTEREST_NEGATIVE_CONTROLS } from "./protocolContainerInterestNegativeControls";
import { CONTAINER_MOVE_REPLAY_NEGATIVE_CONTROLS } from "./protocolContainerMoveReplayNegativeControls";
import { DEFERRED_TAIL_NEGATIVE_CONTROLS } from "./protocolDeferredTailNegativeControls";
import { DOCUMENT_MOVE_NEGATIVE_CONTROLS } from "./protocolDocumentMoveNegativeControls";
import { GROUP_GRANT_REVOCATION_NEGATIVE_CONTROLS } from "./protocolGroupGrantRevocationNegativeControls";
import { HISTORICAL_POLICY_NEGATIVE_CONTROLS } from "./protocolHistoricalPolicyNegativeControls";
import { HISTORY_NEGATIVE_CONTROLS } from "./protocolHistoryNegativeControls";
import { NO_BRICK_NEGATIVE_CONTROLS } from "./protocolNoBrickNegativeControls";
import { PURGE_SCOPE_NEGATIVE_CONTROLS } from "./protocolPurgeScopeNegativeControls";
import { READ_MODEL_STAMP_NEGATIVE_CONTROLS } from "./protocolReadModelStampNegativeControls";
import { RECOVERY_NEGATIVE_CONTROLS } from "./protocolRecoveryNegativeControls";
import { RESTART_PROBE_NEGATIVE_CONTROLS } from "./protocolRestartProbeNegativeControls";
import { SESSION_RETRY_NEGATIVE_CONTROLS } from "./protocolSessionRetryNegativeControls";
import { SYNC_LANE_NEGATIVE_CONTROLS } from "./protocolSyncLaneNegativeControls";
import { SYSTEM_DESTINATION_NEGATIVE_CONTROLS } from "./protocolSystemDestinationNegativeControls";
import { TERMINAL_ANCHOR_NEGATIVE_CONTROLS } from "./protocolTerminalAnchorNegativeControls";
import { TOMBSTONE_NEGATIVE_CONTROLS } from "./protocolTombstoneNegativeControls";

/**
 * Registered fault injections into bounded protocol configurations. Each
 * control disables a production guard and names the exact violation required
 * by checkProtocolNegativeControls.ts; positive runs check the intact rules.
 */

export type ExpectedViolation =
  | { readonly kind: "invariant"; readonly name: string }
  | { readonly kind: "action"; readonly name: string }
  | { readonly kind: "liveness"; readonly name: string };

export interface NegativeControl {
  readonly id: string;
  /** Repository-relative module path. */
  readonly module: string;
  /** Repository-relative registered configuration the control derives from. */
  readonly config: string;
  /** Constant assignments that replace the registered values. */
  readonly constants: Readonly<Record<string, string>>;
  readonly expect: ExpectedViolation;
  readonly why: string;
}

export const NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  ...ACKNOWLEDGEMENT_NEGATIVE_CONTROLS,
  ...ANCESTOR_RECOVERY_NEGATIVE_CONTROLS,
  ...PURGE_SCOPE_NEGATIVE_CONTROLS,
  ...SESSION_RETRY_NEGATIVE_CONTROLS,
  ...SYNC_LANE_NEGATIVE_CONTROLS,
  ...HISTORY_NEGATIVE_CONTROLS,
  ...NO_BRICK_NEGATIVE_CONTROLS,
  ...CONTAINER_DEPTH_NEGATIVE_CONTROLS,
  ...CONTAINER_GRANT_SCOPE_NEGATIVE_CONTROLS,
  ...GROUP_GRANT_REVOCATION_NEGATIVE_CONTROLS,
  ...CONTAINER_INTEREST_NEGATIVE_CONTROLS,
  ...HISTORICAL_POLICY_NEGATIVE_CONTROLS,
  ...ATTACHMENT_NEGATIVE_CONTROLS,
  ...BASELINE_DOMINANCE_NEGATIVE_CONTROLS,
  ...TOMBSTONE_NEGATIVE_CONTROLS,
  ...DOCUMENT_MOVE_NEGATIVE_CONTROLS,
  ...DEFERRED_TAIL_NEGATIVE_CONTROLS,
  ...RECOVERY_NEGATIVE_CONTROLS,
  ...RESTART_PROBE_NEGATIVE_CONTROLS,
  ...CONTAINER_ADOPTION_NEGATIVE_CONTROLS,
  ...CONTAINER_MOVE_REPLAY_NEGATIVE_CONTROLS,
  ...READ_MODEL_STAMP_NEGATIVE_CONTROLS,
  {
    id: "purged-queue-starts-remote-create",
    module: "formal/local-trust/QueuedDocumentCreate.tla",
    config: "formal/local-trust/QueuedDocumentCreate.cfg",
    constants: { CheckDurableRow: "FALSE" },
    expect: { kind: "invariant", name: "PurgedQueueDoesNotStart" },
    why: "A queued in-memory store must not begin remote creation after its durable document row was purged.",
  },
  {
    id: "purged-queue-clears-replacement",
    module: "formal/local-trust/QueuedDocumentCreate.tla",
    config: "formal/local-trust/QueuedDocumentCreate.cfg",
    constants: { CheckCurrentGeneration: "FALSE" },
    expect: { kind: "invariant", name: "ReplacementStoreSurvives" },
    why: "A missing-row read from an obsolete generation must not clear a replacement store.",
  },
  {
    id: "unacknowledged-create-seed-settles",
    module: "formal/local-trust/QueuedDocumentCreate.tla",
    config: "formal/local-trust/QueuedDocumentCreate.cfg",
    constants: { RequireSeedAcknowledgement: "FALSE" },
    expect: { kind: "invariant", name: "SettledSeedIsCommitted" },
    why: "A create acknowledgement that does not name the seed (a plain fallback) must not settle the queued row (#2585).",
  },
  {
    id: "adopted-create-drops-seed",
    module: "formal/local-trust/QueuedDocumentCreate.tla",
    config: "formal/local-trust/QueuedDocumentCreate.cfg",
    constants: { KeepSeedOnAdoption: "FALSE" },
    expect: { kind: "invariant", name: "SettledSeedIsCommitted" },
    why: "Adopting a create whose response was lost must keep the seed queued: the lost attempt may have been the plain fallback (#2585).",
  },
  {
    id: "planned-id-hint-dropped-before-create-response",
    module: "formal/local-trust/QueuedDocumentCreate.tla",
    config: "formal/local-trust/QueuedDocumentCreate.cfg",
    constants: { KeepPlannedIdHints: "FALSE" },
    expect: { kind: "invariant", name: "PeerEditIsPulled" },
    why: "A peer edit hinted before the create response installs the document id must still mark the store pending: the seeded create skips its pull (#2585).",
  },
  {
    id: "seeded-create-clears-post-submit-signal",
    module: "formal/local-trust/QueuedDocumentCreate.tla",
    config: "formal/local-trust/QueuedDocumentCreate.cfg",
    constants: { ClearOnlyConsumedSignal: "FALSE" },
    expect: { kind: "invariant", name: "PeerEditIsPulled" },
    why: "Settling a seed may answer only the signal its pass consumed before submission; a later peer hint must still lead to a pull (#2585).",
  },
  {
    id: "content-write-unrefreshed-citations",
    module: "formal/document-sync/ContentWriteAuthority.tla",
    config: "formal/document-sync/ContentWriteAuthority.cfg",
    constants: { RefreshMissingCitations: "FALSE" },
    expect: { kind: "invariant", name: "HonestWritesRemainReadable" },
    why: "A write may cite a head committed after the reader fetched its projection; verify one fresh projection before refusing the frozen response.",
  },
  {
    id: "host-restore-binds-a-switched-identity",
    module: "formal/local-trust/UnacknowledgedInput.tla",
    config: "formal/local-trust/UnacknowledgedInput.cfg",
    constants: { CheckRestoreIdentity: "FALSE" },
    expect: { kind: "invariant", name: "HostRestoresKeepIdentity" },
    why: "An async host restore can finish after the SDK changes identity but before React cancels the old effect (#2266).",
  },
  {
    id: "discovery-replaces-pending-links",
    module: "formal/local-trust/UnacknowledgedInput.tla",
    config: "formal/local-trust/UnacknowledgedInput.cfg",
    constants: { DeferLinkDiscovery: "FALSE" },
    expect: { kind: "invariant", name: "PendingLinksKeepIntent" },
    why: "Deferring the document row is insufficient if discovery still replaces its pending container links (#2266).",
  },

  {
    id: "container-metadata-without-owner-scope",
    module: "formal/container-keying/ContainerDeletion.tla",
    config: "formal/container-keying/ContainerDeletion.cfg",
    constants: { CheckMetadataScope: "FALSE" },
    expect: { kind: "invariant", name: "MetadataStaysWithOwner" },
    why: "A live reserved metadata ID must not be created under an unrelated container whose content would disappear on metadata teardown (#2266).",
  },
  {
    id: "content-write-pinned-parent",
    module: "formal/document-sync/ContentWriteAuthority.tla",
    config: "formal/document-sync/ContentWriteAuthority.cfg",
    constants: { ReadPinnedParent: "TRUE" },
    expect: { kind: "invariant", name: "HonestWritesRemainReadable" },
    why: "Rebuilding from the original parent pin loses a later grant after the leaf advances (#2266).",
  },
  {
    id: "content-write-current-membership",
    module: "formal/document-sync/ContentWriteAuthority.tla",
    config: "formal/document-sync/ContentWriteAuthority.cfg",
    constants: { ReadCurrentMembership: "TRUE" },
    expect: { kind: "invariant", name: "HonestWritesRemainReadable" },
    why: "Current membership rejects a delayed write committed before the signer was removed (#2266).",
  },
  {
    id: "content-write-stale-submission",
    module: "formal/document-sync/ContentWriteAuthority.tla",
    config: "formal/document-sync/ContentWriteAuthority.cfg",
    constants: { RequireCurrentCitations: "FALSE" },
    expect: { kind: "invariant", name: "NewWritesUseCurrentAuthority" },
    why: "Without current path equality a removed writer submits a stale signed authorization (#2266).",
  },
  {
    id: "content-write-unauthorized-citation",
    module: "formal/document-sync/ContentWriteAuthority.tla",
    config: "formal/document-sync/ContentWriteAuthority.cfg",
    constants: { CheckWriteAuthority: "FALSE" },
    expect: { kind: "invariant", name: "CommittedWritesAreAuthorized" },
    why: "A write whose cited path no longer grants its signer write access must be refused at commit.",
  },
  {
    id: "directory-scope",
    module: "formal/local-trust/OrganizationScope.tla",
    config: "formal/local-trust/OrganizationScope.cfg",
    constants: { RequireDirectoryScope: "FALSE" },
    expect: { kind: "invariant", name: "CachedGroupsHaveSignedScope" },
    why: "A signed directory from another organization cannot bind a group to the requested scope (#2266).",
  },
  {
    id: "directory-head",
    module: "formal/local-trust/OrganizationScope.tla",
    config: "formal/local-trust/OrganizationScope.cfg",
    constants: { RequireDirectoryHead: "FALSE" },
    expect: { kind: "invariant", name: "CachedGroupsHaveSignedScope" },
    why: "The group chain must contain the head authenticated by the signed organization directory (#2266).",
  },
  {
    id: "directory-historical-reference",
    module: "formal/local-trust/OrganizationScope.tla",
    config: "formal/local-trust/OrganizationScope.cfg",
    constants: { RequireReferenceCurrent: "TRUE" },
    expect: { kind: "invariant", name: "HistoricalReferencesRemainCacheable" },
    why: "A current directory head also authenticates its verified predecessors; exact reference currency bricks historical key recovery (#2266).",
  },
  {
    id: "container-parent-scope",
    module: "formal/local-trust/OrganizationScope.tla",
    config: "formal/local-trust/OrganizationScope.cfg",
    constants: { RequireParentScope: "FALSE" },
    expect: { kind: "invariant", name: "ParentEdgesStayInOrganization" },
    why: "A writable parent in another organization cannot authorize container creation or movement (#2266).",
  },
  ...SYSTEM_DESTINATION_NEGATIVE_CONTROLS,
  ...TERMINAL_ANCHOR_NEGATIVE_CONTROLS,
  {
    id: "container-delete-without-live-row-check",
    module: "formal/container-keying/ContainerDeletion.tla",
    config: "formal/container-keying/ContainerDeletion.cfg",
    constants: { CheckLiveContainer: "FALSE" },
    expect: { kind: "invariant", name: "LinkedDocumentsHaveLiveContainer" },
    why: "A retained signed head is insufficient to authorize a new document in a deleted container (#2266).",
  },
  {
    id: "container-delete-without-shared-lock",
    module: "formal/container-keying/ContainerDeletion.tla",
    config: "formal/container-keying/ContainerDeletion.cfg",
    constants: { SerializeDeletion: "FALSE" },
    expect: { kind: "invariant", name: "LinkedDocumentsHaveLiveContainer" },
    why: "Deletion can pass its emptiness check while an authorized document create is uncommitted.",
  },
  {
    id: "container-delete-releases-metadata-id",
    module: "formal/container-keying/ContainerDeletion.tla",
    config: "formal/container-keying/ContainerDeletion.cfg",
    constants: { PreserveMetadataReservation: "FALSE" },
    expect: { kind: "invariant", name: "RetiredMetadataIsNeverRecreated" },
    why: "Dropping the metadata reservation allows a new history to reuse a retired document ID (#2266).",
  },
  {
    id: "discovery-adopts-pending-create",
    module: "formal/local-trust/UnacknowledgedInput.tla",
    config: "formal/local-trust/UnacknowledgedInput.cfg",
    constants: { DeferDiscoveryAdoption: "FALSE" },
    expect: { kind: "invariant", name: "AdoptionHasVerifiedScope" },
    why: "An unsigned listing can stamp a pending create and redirect its queued edits (#2266).",
  },
  {
    id: "login-rebinds-acknowledged-identity",
    module: "formal/local-trust/UnacknowledgedInput.tla",
    config: "formal/local-trust/UnacknowledgedInput.cfg",
    constants: { EnforceLoginBinding: "FALSE" },
    expect: { kind: "action", name: "AcknowledgmentsNeverChange" },
    why: "A dishonest auth response rebinds a previously acknowledged signing identity to another user ID (#2266).",
  },
  {
    id: "reboot-rebinds-durable-signing-identity",
    module: "formal/local-trust/DurableIdentityBinding.tla",
    config: "formal/local-trust/DurableIdentityBinding.cfg",
    constants: { CheckReverseBinding: "FALSE" },
    expect: { kind: "invariant", name: "SigningFingerprintsHaveOneUser" },
    why: "A fresh session accepts a second user for an already pinned signing fingerprint after losing volatile acknowledgments (#2329).",
  },
  {
    id: "login-replaces-pinned-identity",
    module: "formal/local-trust/DurableIdentityBinding.tla",
    config: "formal/local-trust/DurableIdentityBinding.cfg",
    constants: { CheckPinCompare: "FALSE" },
    expect: { kind: "action", name: "PinsNeverChange" },
    why: "A login presenting another signing key for a pinned user must not replace the pin.",
  },
  {
    id: "login-finishes-under-switched-identity",
    module: "formal/local-trust/UnacknowledgedInput.tla",
    config: "formal/local-trust/UnacknowledgedInput.cfg",
    constants: { CheckLoginIdentity: "FALSE" },
    expect: { kind: "invariant", name: "LoginsKeepIdentity" },
    why: "A login that finishes after the device switched identity must not acknowledge its user for the new identity.",
  },
  {
    id: "deleted-container-grant-blocks-policy",
    module: "formal/container-keying/PrincipalReferenceProgress.tla",
    config: "formal/container-keying/PrincipalReferenceProgress.cfg",
    constants: { FilterDeletedGrants: "FALSE" },
    expect: { kind: "invariant", name: "DeletedGrantsDoNotBlockProgress" },
    why: "A deleted container retains its signed grant but must not block group rotation (#2365 finding 4).",
  },
  {
    id: "container-grant-selects-old-group-key",
    module: "formal/container-keying/PrincipalReferenceProgress.tla",
    config: "formal/container-keying/PrincipalReferenceProgress.cfg",
    constants: { EnforceCurrent: "FALSE" },
    expect: { kind: "invariant", name: "CommittedReferencesAreCurrent" },
    why: "A new grant can select an older group key when only predecessor monotonicity is enforced (#2266).",
  },
  {
    id: "container-successor-regresses-group-reference",
    module: "formal/container-keying/PrincipalReferenceProgress.tla",
    config: "formal/container-keying/PrincipalReferenceProgress.cfg",
    constants: { EnforceProgress: "FALSE" },
    expect: { kind: "action", name: "HeldReferencesNeverRegress" },
    why: "A dishonest server can serve a signed successor that reintroduces an older group reference (#2266).",
  },
  {
    id: "empty-frontier-unlink-unlocked",
    module: "formal/document-sync/EmptyFrontierUnlink.tla",
    config: "formal/document-sync/EmptyFrontierUnlink.cfg",
    constants: { LockedUnlink: "FALSE" },
    expect: { kind: "invariant", name: "NoDataLoss" },
    why: "Without the manifest-head lock a writer commits between the emptiness proof and the unlink commit, and the rotation orphans its update.",
  },
  {
    id: "empty-frontier-link-advances-epoch",
    module: "formal/document-sync/EmptyFrontierUnlink.tla",
    config: "formal/document-sync/EmptyFrontierUnlink.cfg",
    constants: { RequireEmptyFrontierOnLinkAdvance: "FALSE" },
    expect: { kind: "invariant", name: "NoDataLoss" },
    why: "A link carries no rotation baseline, so accepting one that advances the content-key epoch strands committed updates from the new container's members (#2365 finding 28).",
  },
  {
    id: "empty-frontier-check-ignores-baselines",
    module: "formal/document-sync/EmptyFrontierUnlink.tla",
    config: "formal/document-sync/EmptyFrontierUnlink.cfg",
    constants: { FrontierCheck: '"uncovered"' },
    expect: { kind: "invariant", name: "NoDataLoss" },
    why: "A rotation baseline is itself a committed update sealed to its own epoch, so a later advance that checks only the uncovered frontier strands it.",
  },
  {
    id: "empty-frontier-short-baseline",
    module: "formal/document-sync/EmptyFrontierUnlink.tla",
    config: "formal/document-sync/EmptyFrontierUnlink.cfg",
    constants: { CheckBaselineCoversFrontier: "FALSE" },
    expect: { kind: "invariant", name: "NoDataLoss" },
    why: "An unlink whose rotation baseline falls short of the committed frontier strands every update the baseline does not cover.",
  },
  {
    id: "empty-frontier-baseline-skips-earlier-baseline",
    module: "formal/document-sync/EmptyFrontierUnlink.tla",
    config: "formal/document-sync/EmptyFrontierUnlink.cfg",
    constants: { BaselineFrontier: '"uncovered"' },
    expect: { kind: "invariant", name: "NoDataLoss" },
    why: "A baseline compared only with updates since the latest baseline lets the next rotation drop that earlier baseline's history.",
  },
];

export type { ParsedConfig } from "./protocolNegativeControlConfig";
export {
  parseConfig,
  renderNegativeControlConfig,
  violationPattern,
} from "./protocolNegativeControlConfig";
