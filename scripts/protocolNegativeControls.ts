/**
 * Registry and rendering for the protocol negative controls. Each control
 * derives a configuration from a registered model configuration with one
 * refusal rule or lock flipped away from its production value, and names
 * the single invariant or property TLC must then report as violated. The
 * registered runs prove the production rule set satisfies the invariants;
 * these runs prove each invariant is not vacuous and name the rule that
 * carries it. scripts/checkProtocolNegativeControls.ts runs the registry.
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

const NO_BRICK_MODULE = "formal/container-keying/NoBrickedDevice.tla";
const NO_BRICK_HONEST = "formal/container-keying/NoBrickedDevice.cfg";
const NO_BRICK_ADVERSARY =
  "formal/container-keying/NoBrickedDeviceAdversary.cfg";

export const NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    id: "content-write-unrefreshed-citations",
    module: "formal/document-sync/ContentWriteAuthority.tla",
    config: "formal/document-sync/ContentWriteAuthority.cfg",
    constants: { RefreshMissingCitations: "FALSE" },
    expect: { kind: "invariant", name: "HonestWritesRemainReadable" },
    why: "A write may cite a head committed after the reader fetched its projection; verify one fresh projection before refusing the frozen response.",
  },
  {
    id: "stale-reconnect-proof-handoff",
    module: "formal/realtime/ContainerInterest.tla",
    config: "formal/realtime/ContainerInterest.cfg",
    constants: { CheckRestoreDependencies: "FALSE" },
    expect: { kind: "invariant", name: "OnlyReadableInterests" },
    why: "A fresh reconnect proof may be reused only before an observed access change.",
  },
  {
    id: "principal-change-keeps-container-interest",
    module: "formal/realtime/ContainerInterest.tla",
    config: "formal/realtime/ContainerInterest.cfg",
    constants: { NotifyPrincipalChanges: "FALSE" },
    expect: { kind: "invariant", name: "OnlyReadableInterests" },
    why: "A group membership removal changes read access even if no container manifest changes; principal notifications must evict its subscriptions (#2266).",
  },
  {
    id: "unrelated-container-authorization-retry",
    module: "formal/realtime/ContainerInterest.tla",
    config: "formal/realtime/ContainerInterest.cfg",
    constants: { ScopeQueryChanges: "FALSE" },
    expect: { kind: "invariant", name: "NoUnrelatedRetries" },
    why: "Retrying a denied declaration on another tenant's mutation consumes its retry budget without changing access (#2266).",
  },
  {
    id: "unrelated-container-interest-eviction",
    module: "formal/realtime/ContainerInterest.tla",
    config: "formal/realtime/ContainerInterest.cfg",
    constants: { ScopeInvalidation: "FALSE" },
    expect: { kind: "invariant", name: "UnrelatedInterestsPreserved" },
    why: "Global eviction removes a different tenant's independent subscription instead of following verified ancestry (#2266).",
  },
  {
    id: "unauthorized-container-interest",
    module: "formal/realtime/ContainerInterest.tla",
    config: "formal/realtime/ContainerInterest.cfg",
    constants: { AuthorizeInterest: "FALSE" },
    expect: { kind: "invariant", name: "OnlyReadableInterests" },
    why: "Removing authorization admits a denied subscription and violates OnlyReadableInterests (#2266).",
  },
  {
    id: "stale-container-interest-authorization",
    module: "formal/realtime/ContainerInterest.tla",
    config: "formal/realtime/ContainerInterest.cfg",
    constants: { InvalidateOnAccessChange: "FALSE" },
    expect: { kind: "invariant", name: "OnlyReadableInterests" },
    why: "Removing dependency invalidation keeps a revoked subscription and violates OnlyReadableInterests (#2266).",
  },
  {
    id: "closed-socket-interest-authorization",
    module: "formal/realtime/ContainerInterest.tla",
    config: "formal/realtime/ContainerInterest.cfg",
    constants: { CheckSocketOpen: "FALSE" },
    expect: { kind: "invariant", name: "ClosedSocketsNeverIndexed" },
    why: "Removing the live-socket guard lets a late result violate ClosedSocketsNeverIndexed (#2266).",
  },
  {
    id: "sync-publishes-before-durable-claim",
    module: "formal/document-sync/DeferredTailSettlement.tla",
    config: "formal/document-sync/DeferredTailSettlement.cfg",
    constants: { RequireDurablePublication: "FALSE" },
    expect: { kind: "invariant", name: "PublishedHistoryIsDurable" },
    why: "Publishing a rejected incoming candidate exposes text whose history is absent from the next local edit's durable basis.",
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
  {
    id: "cached-destination-can-move",
    module: "formal/local-trust/SystemDestination.tla",
    config: "formal/local-trust/SystemDestination.cfg",
    constants: { PreserveDestinationIdentity: "FALSE" },
    expect: { kind: "invariant", name: "CachedDestinationsNeverMove" },
    why: "Cached root and system roles require immutable signed parent identities (#2266).",
  },
  {
    id: "system-destination-trusts-listing",
    module: "formal/local-trust/SystemDestination.tla",
    config: "formal/local-trust/SystemDestination.cfg",
    constants: { VerifyDestination: "FALSE" },
    expect: { kind: "invariant", name: "OnlySignedSlotReceivesSystemWrites" },
    why: "A forged unsigned slot must not redirect private system writes.",
  },
  {
    id: "root-destination-ignores-session",
    module: "formal/local-trust/SystemDestination.tla",
    config: "formal/local-trust/SystemDestination.cfg",
    constants: { RequireSessionRoot: "FALSE" },
    expect: { kind: "invariant", name: "OnlyOwnRootReceivesLocalContent" },
    why: "A different signed root must not adopt the session pre-login content.",
  },
  {
    id: "system-slot-created-by-writer",
    module: "formal/local-trust/SystemDestination.tla",
    config: "formal/local-trust/SystemDestination.cfg",
    constants: { RequireSystemAdministrator: "FALSE" },
    expect: { kind: "invariant", name: "OnlyAdministratorsCreateSlots" },
    why: "A root writer must not mint a system-slot decoy.",
  },
  {
    id: "no-brick-signer-revoked-at-current",
    module: NO_BRICK_MODULE,
    config: NO_BRICK_HONEST,
    constants: { RefuseSignerRevokedAtCurrent: "TRUE" },
    expect: { kind: "invariant", name: "HonestServerNeverRefused" },
    why: "Requiring current membership rejects an honest late-delivered head signed before the group removed its signer (#2266).",
  },
  {
    id: "restore-drops-terminal-anchors",
    module: "formal/backup-restore/TerminalAnchors.tla",
    config: "formal/backup-restore/TerminalAnchors.cfg",
    constants: { PreserveAnchors: "FALSE" },
    expect: { kind: "action", name: "PurgePinsNeverChange" },
    why: "Replacing security tables with an older backup erases a verified purge decision (#2266).",
  },
  {
    id: "restore-drops-incident-evidence",
    module: "formal/backup-restore/TerminalAnchors.tla",
    config: "formal/backup-restore/TerminalAnchors.cfg",
    constants: { PreserveAnchors: "FALSE" },
    expect: { kind: "action", name: "IncidentEvidenceNeverLost" },
    why: "Replacing security tables with an older backup erases recorded incident evidence (#2266).",
  },
  {
    id: "restore-stale-preflight",
    module: "formal/backup-restore/TerminalAnchors.tla",
    config: "formal/backup-restore/TerminalAnchors.cfg",
    constants: { RecheckAtCommit: "FALSE" },
    expect: { kind: "action", name: "PurgePinsNeverChange" },
    why: "Reusing a preflight merge loses a purge observed before the database write transaction.",
  },
  {
    id: "restore-stale-incident-preflight",
    module: "formal/backup-restore/TerminalAnchors.tla",
    config: "formal/backup-restore/TerminalAnchors.cfg",
    constants: { RecheckAtCommit: "FALSE" },
    expect: { kind: "action", name: "IncidentEvidenceNeverLost" },
    why: "Reusing a preflight merge loses incident evidence observed before the database write transaction.",
  },
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
    id: "no-brick-stale-head-citation",
    module: NO_BRICK_MODULE,
    config: NO_BRICK_HONEST,
    constants: { RefuseStaleHeadCitation: "TRUE" },
    expect: { kind: "liveness", name: "DeviceEventuallyCurrent" },
    why: "The withdrawn #2174 currency rule refuses an honest late-delivered head, so a device that already holds the dependent can never advance without another device's write.",
  },
  {
    id: "no-brick-stale-head-citation-refuses-honest-server",
    module: NO_BRICK_MODULE,
    config: NO_BRICK_HONEST,
    constants: { RefuseStaleHeadCitation: "TRUE" },
    expect: { kind: "invariant", name: "HonestServerNeverRefused" },
    why: "The same rule, caught as a safety violation: the refused projection is the honest server's.",
  },
  {
    id: "no-brick-stale-chain-citation",
    module: NO_BRICK_MODULE,
    config: NO_BRICK_HONEST,
    constants: { RefuseStaleChainCitation: "TRUE" },
    expect: { kind: "liveness", name: "DeviceEventuallyCurrent" },
    why: "The #2173 principal-policy currency rule refuses every chain entry above the checkpoint that cites an older authority head, so even a later honest successor cannot heal the device.",
  },
  {
    id: "no-brick-fork",
    module: NO_BRICK_MODULE,
    config: NO_BRICK_ADVERSARY,
    constants: { RefuseFork: "FALSE" },
    expect: { kind: "action", name: "HeldChainNeverContradictsCheckpoint" },
    why: "Without the checkpoint chain rule a device accepts a same-epoch fork or a chain that does not extend what it already holds.",
  },
  {
    id: "no-brick-rollback",
    module: NO_BRICK_MODULE,
    config: NO_BRICK_ADVERSARY,
    constants: { RefuseRollback: "FALSE" },
    expect: { kind: "action", name: "CheckpointsAreMonotone" },
    why: "Without the rollback rule a device accepts a head or authority below its own checkpoint.",
  },
  {
    id: "no-brick-citation-regression",
    module: NO_BRICK_MODULE,
    config: NO_BRICK_ADVERSARY,
    constants: { RefuseCitationRegression: "FALSE" },
    expect: { kind: "action", name: "HeldCitationsNeverRegress" },
    why: "Without the lineage floor a forged head can cite an authority head older than the one its predecessor established.",
  },
  {
    id: "no-brick-served-authority-rollback",
    module: NO_BRICK_MODULE,
    config: NO_BRICK_ADVERSARY,
    constants: { RefuseServedAuthorityRollback: "FALSE" },
    expect: { kind: "invariant", name: "HeldAuthorityCoversHeldCitation" },
    why: "Without the served-ancestor rule a device accepts a current authority head older than the one the dependent head's signature proves exists.",
  },
  {
    id: "no-brick-signer-revoked-at-citation",
    module: NO_BRICK_MODULE,
    config: NO_BRICK_ADVERSARY,
    constants: { RefuseSignerRevokedAtCitation: "FALSE" },
    expect: { kind: "invariant", name: "HeldSignerWasMemberAtCitation" },
    why: "Without authorization at the cited head a revoked member's forged head citing a post-revocation authority is accepted.",
  },
  {
    id: "empty-frontier-unlink-unlocked",
    module: "formal/document-sync/EmptyFrontierUnlink.tla",
    config: "formal/document-sync/EmptyFrontierUnlink.cfg",
    constants: { LockedUnlink: "FALSE" },
    expect: { kind: "invariant", name: "NoDataLoss" },
    why: "Without the manifest-head lock a writer commits between the emptiness proof and the unlink commit, and the rotation orphans its update.",
  },
];

export type { ParsedConfig } from "./protocolNegativeControlConfig";
export {
  parseConfig,
  renderNegativeControlConfig,
  violationPattern,
} from "./protocolNegativeControlConfig";
