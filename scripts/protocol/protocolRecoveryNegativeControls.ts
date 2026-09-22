import type { NegativeControl } from "./protocolNegativeControls";

const RAW_HISTORY_MODULE = "formal/document-sync/RawHistoryRecovery.tla";
const RAW_HISTORY_CONFIG = "formal/document-sync/RawHistoryRecovery.cfg";

export const RECOVERY_NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    id: "recovery-never-finishes-verified-install",
    module: RAW_HISTORY_MODULE,
    config: "formal/document-sync/RawHistoryRecoveryProgress.cfg",
    constants: { FinishVerifiedRecovery: "FALSE" },
    expect: { kind: "liveness", name: "RecoveryEventuallyTerminates" },
    why: "A verified recovery must finish without relying on an external reset or competing writer to unstick it.",
  },
  {
    id: "recovery-publishes-after-generation-change",
    module: RAW_HISTORY_MODULE,
    config: RAW_HISTORY_CONFIG,
    constants: { RequireCurrentGeneration: "FALSE" },
    expect: { kind: "invariant", name: "ChangedGenerationNeverPublishes" },
    why: "A reset after exact-history verification must prevent the old recovery from publishing into its replacement generation.",
  },
  {
    id: "recovery-overwrites-winning-install",
    module: RAW_HISTORY_MODULE,
    config: RAW_HISTORY_CONFIG,
    constants: { RequireWinningInstall: "FALSE" },
    expect: { kind: "invariant", name: "SupersededInstallNeverPublishes" },
    why: "A recovery that loses the record/checkpoint comparison must preserve the competing install.",
  },
  {
    id: "recovery-retains-queued-checkpoints",
    module: RAW_HISTORY_MODULE,
    config: RAW_HISTORY_CONFIG,
    constants: { RetireCheckpoints: "FALSE" },
    expect: {
      kind: "invariant",
      name: "CompleteRecoveryRetiresQueuedCheckpoints",
    },
    why: "Successful reconstruction must retire checkpoint artifacts, including ones queued during collection.",
  },
  {
    id: "writer-crosses-recovery-fence",
    module: RAW_HISTORY_MODULE,
    config: RAW_HISTORY_CONFIG,
    constants: { FenceBlockedWriters: "FALSE" },
    expect: {
      kind: "invariant",
      name: "CompleteRecoveryContainsAllOrdinaryHistory",
    },
    why: "A resumed writer must not overwrite the recovered checkpoint with its stale pre-recovery history.",
  },
  {
    id: "strict-parent-epoch-pin-strands-descendant",
    module: "formal/container-keying/KeyringReachability.tla",
    config: "formal/container-keying/KeyringReachability.cfg",
    constants: { StrictParentEpochPin: "TRUE" },
    expect: { kind: "invariant", name: "HonestServesNeverStranded" },
    why: "Verification requiring the child pin to equal the parent's CURRENT epoch strands every descendant after an ancestor rotation, even though the parent's retained history still covers the pinned epoch.",
  },
  {
    id: "own-edge-currency-writes-under-revoked-reach",
    module: "formal/container-keying/InaccessibleIntermediateRepair.tla",
    config: "formal/container-keying/InaccessibleIntermediateRepair.cfg",
    constants: { RotationCarriesRepairs: "FALSE", WholePathCurrency: "FALSE" },
    expect: { kind: "invariant", name: "NoWriteUnderRevokedReach" },
    why: "Where a rotation leaves an intermediate stale, a writer that checks only its own parent edge encrypts below a key a revoked ancestor member still opens; whole-path currency is the backstop (#2340).",
  },
  {
    id: "rotation-without-descendant-repairs-bricks-leaf-writer",
    module: "formal/container-keying/InaccessibleIntermediateRepair.tla",
    config: "formal/container-keying/InaccessibleIntermediateRepair.cfg",
    constants: { RotationCarriesRepairs: "FALSE" },
    expect: { kind: "liveness", name: "WriterEventuallyUnblocked" },
    why: "A rotation that leaves the intermediate stale makes a leaf-only writer's writes wait on another device's re-key, which no-brick forbids depending on (#2340).",
  },
  {
    id: "leaf-writer-given-intermediate-key",
    module: "formal/container-keying/InaccessibleIntermediateRepair.tla",
    config: "formal/container-keying/InaccessibleIntermediateRepair.cfg",
    constants: { RotationCarriesRepairs: "FALSE", WriterGivenMidKey: "TRUE" },
    expect: { kind: "invariant", name: "WriterHoldsOnlyGrantedKeys" },
    why: "Unblocking a leaf-only writer by serving it the stale intermediate's key, instead of carrying the repair in the rotation, hands it a key outside its grant (#2340).",
  },
];
