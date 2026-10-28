import type { NegativeControl } from "./protocolNegativeControls";

const MODULE = "formal/backup-restore/TerminalAnchors.tla";
const CONFIG = "formal/backup-restore/TerminalAnchors.cfg";

export const TERMINAL_ANCHOR_NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    id: "restore-drops-terminal-anchors",
    module: MODULE,
    config: CONFIG,
    constants: { PreserveAnchors: "FALSE" },
    expect: { kind: "action", name: "PurgePinsNeverChange" },
    why: "Replacing security tables with an older backup erases a verified purge decision (#2266).",
  },
  {
    id: "restore-drops-incident-evidence",
    module: MODULE,
    config: CONFIG,
    constants: { PreserveAnchors: "FALSE" },
    expect: { kind: "action", name: "IncidentEvidenceNeverLost" },
    why: "Replacing security tables with an older backup erases recorded incident evidence (#2266).",
  },
  {
    id: "restore-stale-preflight",
    module: MODULE,
    config: CONFIG,
    constants: { RecheckAtCommit: "FALSE" },
    expect: { kind: "action", name: "PurgePinsNeverChange" },
    why: "Reusing a preflight merge loses a purge observed before the database write transaction.",
  },
  {
    id: "restore-stale-incident-preflight",
    module: MODULE,
    config: CONFIG,
    constants: { RecheckAtCommit: "FALSE" },
    expect: { kind: "action", name: "IncidentEvidenceNeverLost" },
    why: "Reusing a preflight merge loses incident evidence observed before the database write transaction.",
  },
  {
    id: "terminal-anchor-restores-older-checkpoint",
    module: MODULE,
    config: CONFIG,
    constants: { MergeCheckpointsByMax: "FALSE" },
    expect: { kind: "action", name: "CheckpointsNeverRegress" },
    why: "A restore must keep the higher of the local and backup checkpoint positions, or an older backup rolls verification back.",
  },
];
