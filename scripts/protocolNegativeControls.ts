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
    id: "stale-reconnect-proof-handoff",
    module: "formal/realtime/ContainerInterest.tla",
    config: "formal/realtime/ContainerInterest.cfg",
    constants: { CheckRestoreGeneration: "FALSE" },
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

export interface ParsedConfig {
  readonly specification: string;
  readonly constants: readonly (readonly [string, string])[];
  readonly invariants: readonly string[];
  readonly properties: readonly string[];
}

const KEYWORD_PATTERN =
  /^(SPECIFICATION|CONSTANTS?|INVARIANTS?|PROPERTY|PROPERTIES)\b\s*(.*)$/;
const ASSIGNMENT_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/;

interface ConfigBuilder {
  specification: string;
  readonly constants: (readonly [string, string])[];
  readonly invariants: string[];
  readonly properties: string[];
  section: "constants" | "other";
}

function applyKeywordLine(
  builder: ConfigBuilder,
  word: string,
  remainder: string,
  index: number,
): void {
  builder.section = "other";
  if (word === "SPECIFICATION") {
    builder.specification = remainder;
  } else if (word === "CONSTANT" || word === "CONSTANTS") {
    builder.section = "constants";
    if (remainder !== "") {
      builder.constants.push(parseAssignment(remainder, index));
    }
  } else if (word === "INVARIANT" || word === "INVARIANTS") {
    builder.invariants.push(...remainder.split(/\s+/).filter(Boolean));
  } else {
    builder.properties.push(...remainder.split(/\s+/).filter(Boolean));
  }
}

/**
 * Reads the subset of TLC's configuration grammar the registered
 * configurations use: one SPECIFICATION, CONSTANT assignments inline or in
 * an indented block, and INVARIANT/PROPERTY names. Anything else fails so a
 * configuration feature the renderer cannot reproduce is never silently
 * dropped from a control.
 */
export function parseConfig(source: string): ParsedConfig {
  const builder: ConfigBuilder = {
    specification: "",
    constants: [],
    invariants: [],
    properties: [],
    section: "other",
  };

  for (const [index, rawLine] of source.split("\n").entries()) {
    const line = rawLine.replace(/\\\*.*$/, "").trim();
    if (line === "") {
      continue;
    }
    const keyword = line.match(KEYWORD_PATTERN);
    if (keyword) {
      applyKeywordLine(
        builder,
        keyword[1] ?? "",
        (keyword[2] ?? "").trim(),
        index,
      );
    } else if (builder.section === "constants") {
      builder.constants.push(parseAssignment(line, index));
    } else {
      throw new Error(
        `configuration line ${index + 1} is not supported by the negative-control renderer: ${line}`,
      );
    }
  }

  if (builder.specification === "") {
    throw new Error("configuration declares no SPECIFICATION.");
  }
  const { specification, constants, invariants, properties } = builder;
  return { specification, constants, invariants, properties };
}

function parseAssignment(
  line: string,
  index: number,
): readonly [string, string] {
  const match = line.match(ASSIGNMENT_PATTERN);
  if (!match?.[1] || !match[2]) {
    throw new Error(
      `configuration line ${index + 1} is not a constant assignment: ${line}`,
    );
  }
  return [match[1], match[2].trim()];
}

/**
 * The control's configuration: the registered constants with the control's
 * overrides applied, and only the expected invariant or property, so the
 * violation TLC reports is the one the control names. An override of a
 * constant the base does not assign, or an expectation the base does not
 * check, is a registry error rather than a silently vacuous control.
 */
export function renderNegativeControlConfig(
  base: ParsedConfig,
  control: NegativeControl,
): string {
  const assigned = new Set(base.constants.map(([name]) => name));
  for (const name of Object.keys(control.constants)) {
    if (!assigned.has(name)) {
      throw new Error(
        `${control.id} overrides ${name}, which ${control.config} does not assign.`,
      );
    }
  }
  const checked =
    control.expect.kind === "invariant" ? base.invariants : base.properties;
  if (!checked.includes(control.expect.name)) {
    throw new Error(
      `${control.id} expects ${control.expect.kind} ${control.expect.name}, which ${control.config} does not check.`,
    );
  }
  const constants = base.constants.map(
    ([name, value]) => `  ${name} = ${control.constants[name] ?? value}`,
  );
  const check =
    control.expect.kind === "invariant"
      ? `INVARIANT ${control.expect.name}`
      : `PROPERTY ${control.expect.name}`;
  return `SPECIFICATION ${base.specification}\n\nCONSTANTS\n${constants.join("\n")}\n\n${check}\n`;
}

/** The exact TLC report the control must produce. */
export function violationPattern(expect: ExpectedViolation): RegExp {
  switch (expect.kind) {
    case "invariant":
      return new RegExp(
        `^Error: Invariant ${expect.name} is violated\\.$`,
        "m",
      );
    case "action":
      return new RegExp(
        `^Error: Action property ${expect.name} is violated\\.$`,
        "m",
      );
    case "liveness":
      return /^Error: Temporal properties were violated\.$/m;
  }
}
