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
      name: "BlockedWriterCannotCrossRecoveryFence",
    },
    why: "A writer captured before recovery publication must reject its stale generation when it resumes.",
  },
  {
    id: "root-acknowledgment-never-reprimes-document",
    module: "formal/local-trust/RootDocumentPriming.tla",
    config: "formal/local-trust/RootDocumentPriming.cfg",
    constants: { ReprimeAfterRemoteAcknowledgment: "FALSE" },
    expect: { kind: "liveness", name: "DocumentEventuallySyncs" },
    why: "A document pass deferred before root acknowledgment must be scheduled again even if no further edit occurs.",
  },
];
