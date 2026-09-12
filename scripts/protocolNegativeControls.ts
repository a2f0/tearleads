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
