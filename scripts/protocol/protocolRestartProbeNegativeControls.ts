import type { NegativeControl } from "./protocolNegativeControlTypes";

const RESTART_PROBE_MODULE = "formal/document-sync/RestartProbeConvergence.tla";
const RESTART_PROBE_CONFIG = "formal/document-sync/RestartProbeConvergence.cfg";

export const RESTART_PROBE_NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    id: "restart-probe-drops-queued-request",
    module: RESTART_PROBE_MODULE,
    config: RESTART_PROBE_CONFIG,
    constants: { KeepQueuedRequestAcrossFlight: "FALSE" },
    expect: { kind: "liveness", name: "RequestEventuallyApplied" },
    why: "A finishing probe that clears a request queued while it was in flight never applies the newer remote version.",
  },
  {
    id: "restart-probe-declares-unready-tree",
    module: RESTART_PROBE_MODULE,
    config: RESTART_PROBE_CONFIG,
    constants: { DeclareFromReadyTree: "FALSE" },
    expect: { kind: "invariant", name: "OutstandingDeclarationCoversDocument" },
    why: "A known-containers declaration sent before the local tree is ready can omit the opened document, so its acknowledgement proves nothing.",
  },
  {
    id: "restart-probe-ack-arms-nothing",
    module: RESTART_PROBE_MODULE,
    config: RESTART_PROBE_CONFIG,
    constants: { ArmProbeOnAck: "FALSE" },
    expect: {
      kind: "liveness",
      name: "InterestRecoveryEventuallyCoversBaseline",
    },
    why: "An acknowledgement that records the recovery target without queuing a probe leaves the gap after reconnect unrecovered.",
  },
];
