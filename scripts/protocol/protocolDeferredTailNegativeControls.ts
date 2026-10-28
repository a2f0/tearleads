import type { NegativeControl } from "./protocolNegativeControls";

export const DEFERRED_TAIL_NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    id: "sync-publishes-before-durable-claim",
    module: "formal/document-sync/DeferredTailSettlement.tla",
    config: "formal/document-sync/DeferredTailSettlement.cfg",
    constants: { RequireDurablePublication: "FALSE" },
    expect: { kind: "invariant", name: "PublishedHistoryIsDurable" },
    why: "Publishing a rejected incoming candidate exposes text whose history is absent from the next local edit's durable basis.",
  },
  {
    id: "compaction-deletes-queued-update",
    module: "formal/document-sync/DeferredTailSettlement.tla",
    config: "formal/document-sync/DeferredTailSettlement.cfg",
    constants: { CompactionSparesQueued: "FALSE" },
    expect: { kind: "invariant", name: "WorkingAccountingSound" },
    why: "A queued update is also a history tail row; compaction that deletes it once a checkpoint covers it drops an unsent operation the marker already counts (#2522).",
  },
  {
    id: "deferred-tail-validates-malformed-deletion",
    module: "formal/document-sync/DeferredTailSettlement.tla",
    config: "formal/document-sync/DeferredTailSettlement.cfg",
    constants: { ValidateDeletions: "FALSE" },
    expect: { kind: "action", name: "InvalidResponseCannotAdvance" },
    why: "A malformed deletion response must be rejected like any other malformed response, never applied as an authoritative deletion.",
  },
];
