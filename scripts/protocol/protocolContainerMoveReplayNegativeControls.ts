import type { NegativeControl } from "./protocolNegativeControlTypes";

const MODULE = "formal/local-trust/ContainerMoveReplay.tla";
const CONFIG = "formal/local-trust/ContainerMoveReplay.cfg";

export const CONTAINER_MOVE_REPLAY_NEGATIVE_CONTROLS: readonly NegativeControl[] =
  [
    {
      id: "container-move-replay-rotates-applied-move",
      module: MODULE,
      config: CONFIG,
      constants: { AdoptAppliedMove: "FALSE" },
      expect: { kind: "invariant", name: "NoRedundantRotation" },
      why: "A replay after a lost result must settle from the verified head instead of signing a second rotation to the parent the server already holds (#2556).",
    },
    {
      id: "container-move-lost-result-waits-for-reload",
      module: MODULE,
      config: CONFIG,
      constants: { RearmLostResult: "FALSE" },
      expect: { kind: "liveness", name: "AcceptedMovesSettle" },
      why: "A move the server accepted but no pass settled must schedule its own replay, not wait for an unrelated write or a reload (#2556).",
    },
    {
      id: "container-move-failed-replay-drops-acceptance",
      module: MODULE,
      config: CONFIG,
      constants: { ResumeAcceptedRetry: "FALSE" },
      expect: { kind: "liveness", name: "AcceptedMovesSettle" },
      why: "A re-armed replay that fails before reaching the server, say on a projection read, must keep the accepted move's retries going (#2556).",
    },
    {
      id: "container-move-settles-on-local-claim",
      module: MODULE,
      config: CONFIG,
      constants: { SettleOnLocalClaim: "TRUE" },
      expect: { kind: "invariant", name: "SettleHasEvidence" },
      why: "Settling a queued move because the device already shows it at its destination leaves the server's placement unproven (#2556).",
    },
  ];
