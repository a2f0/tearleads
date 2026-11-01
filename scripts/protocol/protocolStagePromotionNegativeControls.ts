import type { NegativeControl } from "./protocolNegativeControlTypes";

const STAGE_PROMOTION_MODULE = "formal/blob-attachments/StagePromotion.tla";
const STAGE_PROMOTION_CONFIG = "formal/blob-attachments/StagePromotion.cfg";

export const STAGE_PROMOTION_NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    id: "stage-promotion-skips-digest",
    module: STAGE_PROMOTION_MODULE,
    config: STAGE_PROMOTION_CONFIG,
    constants: { CheckAssembledHash: "FALSE" },
    expect: { kind: "invariant", name: "BlobsHoldDeclaredBytes" },
    why: "Without the digest check, parts that assemble to other bytes are promoted as the declared blob.",
  },
  {
    id: "stage-promotion-ignores-expiry",
    module: STAGE_PROMOTION_MODULE,
    config: STAGE_PROMOTION_CONFIG,
    constants: { PromoteRequiresUnexpired: "FALSE" },
    expect: { kind: "invariant", name: "BlobsHoldDeclaredBytes" },
    why: "Promoting a stage cleanup has already claimed creates a blob whose object cleanup then deletes.",
  },
  {
    id: "stage-cleanup-reads-locked-row",
    module: STAGE_PROMOTION_MODULE,
    config: STAGE_PROMOTION_CONFIG,
    constants: { ExpiryLocksStageRow: "FALSE" },
    expect: { kind: "invariant", name: "BlobsHoldDeclaredBytes" },
    why: "Cleanup that reads a stage instead of writing its row sees it before a promotion holding it commits, and deletes the promoted blob's object.",
  },
  {
    id: "stage-promotion-keeps-stage",
    module: STAGE_PROMOTION_MODULE,
    config: STAGE_PROMOTION_CONFIG,
    constants: { DeleteStageOnPromote: "FALSE" },
    expect: { kind: "invariant", name: "BlobsHoldDeclaredBytes" },
    why: "A stage row that outlives its promotion later expires, and cleanup deletes the object the blob still stores.",
  },
  {
    id: "stage-promotion-reuses-blob-id",
    module: STAGE_PROMOTION_MODULE,
    config: STAGE_PROMOTION_CONFIG,
    constants: { CheckRegistryOnPromote: "FALSE" },
    expect: { kind: "liveness", name: "DereferencedBlobsAreSettled" },
    why: "Promoting an id the registry already holds leaves a generation whose registry row names another key, so the sweep can never reclaim it.",
  },
  {
    id: "blob-sweep-without-revival",
    module: STAGE_PROMOTION_MODULE,
    config: STAGE_PROMOTION_CONFIG,
    constants: { ReviveOnBind: "FALSE", GcRechecksReference: "FALSE" },
    expect: { kind: "invariant", name: "SweepKeepsBoundBlobs" },
    why: "With neither the bind's revival nor the sweep's reference recheck, binding a dereferenced blob does not stop the sweep from deleting it; either one alone suffices.",
  },
  {
    id: "purge-orphans-without-blob-locks",
    module: STAGE_PROMOTION_MODULE,
    config: STAGE_PROMOTION_CONFIG,
    constants: { PurgeLocksBlobs: "FALSE" },
    expect: { kind: "invariant", name: "UnboundBlobsAreMarked" },
    why: "A purge that decides orphans before a concurrent detach commits leaves a shared blob unbound and unmarked, so the sweep never reclaims it.",
  },
  {
    id: "stage-cleanup-leaves-assembled-object",
    module: STAGE_PROMOTION_MODULE,
    config: STAGE_PROMOTION_CONFIG,
    constants: { DeleteObjectAfterAbort: "FALSE" },
    expect: { kind: "invariant", name: "NoOrphanObjects" },
    why: "A bind can assemble the object after cleanup reads the stage as pending; an abort that finds no upload then leaves the object with no record.",
  },
  {
    id: "stage-cleanup-deletes-fenced-rows",
    module: STAGE_PROMOTION_MODULE,
    config: STAGE_PROMOTION_CONFIG,
    constants: { DeleteOnlyCleanedRows: "FALSE" },
    expect: { kind: "invariant", name: "NoOrphanObjects" },
    why: "A sweep that loses its lease mid-batch must delete only the rows of stages it cleaned; deleting a fenced stage's row leaves its object with no record.",
  },
  {
    id: "stage-cleanup-strands-fenced-claims",
    module: STAGE_PROMOTION_MODULE,
    config: STAGE_PROMOTION_CONFIG,
    constants: { ReclaimFencedStages: "FALSE" },
    expect: { kind: "liveness", name: "FencedStagesAreReclaimed" },
    why: "A claimed stage the sweep fenced off must stay a candidate for the next sweep, or its row and object are never cleaned.",
  },
];
