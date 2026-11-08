import type { NegativeControl } from "./protocolNegativeControlTypes";

export const OUTGOING_QUEUE_MERGE_NEGATIVE_CONTROLS: readonly NegativeControl[] =
  [
    {
      id: "outgoing-merge-reuses-update-id",
      module: "formal/document-sync/OutgoingQueueMerge.tla",
      config: "formal/document-sync/OutgoingQueueMerge.cfg",
      constants: { MergeReusesId: "TRUE" },
      expect: { kind: "invariant", name: "NoLostLocalOps" },
      why: "A merged row that keeps a member's update id is settled by another runtime's in-flight copy of that member, dropping the newer operations it absorbed (#2851).",
    },
    {
      id: "outgoing-merge-across-checkpoint",
      module: "formal/document-sync/OutgoingQueueMerge.tla",
      config: "formal/document-sync/OutgoingQueueMerge.cfg",
      constants: { MergeAcrossCheckpoint: "TRUE" },
      expect: { kind: "invariant", name: "MergedRowKeepsPosition" },
      why: "Merging rows on both sides of a queued rotation checkpoint or outbox row moves later operations ahead of it (#2851).",
    },
    {
      id: "outgoing-merge-across-span-gap",
      module: "formal/document-sync/OutgoingQueueMerge.tla",
      config: "formal/document-sync/OutgoingQueueMerge.cfg",
      constants: { MergeAcrossGap: "TRUE" },
      expect: { kind: "invariant", name: "MergedRowHoldsExactOps" },
      why: "A run with a per-peer span gap exports the gap's operations too, so the merged row no longer holds exactly its members' operations (#2851).",
    },
  ];
