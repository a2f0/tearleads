import type { NegativeControl } from "./protocolNegativeControlTypes";

export const SYNC_LANE_NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    id: "sync-backoff-never-expires",
    module: "formal/document-sync/SyncLaneConcurrency.tla",
    config: "formal/document-sync/SyncLaneConcurrency.cfg",
    constants: { ExpireBackoff: "FALSE" },
    expect: { kind: "liveness", name: "AllRequestsSettle" },
    why: "A failed retry cannot leave the coordinator permanently non-idle.",
  },
  {
    id: "sync-workers-exceed-bound",
    module: "formal/document-sync/SyncLaneConcurrency.tla",
    config: "formal/document-sync/SyncLaneConcurrency.cfg",
    constants: { EnforceBound: "FALSE" },
    expect: { kind: "invariant", name: "BoundedWorkers" },
    why: "Independent document work must remain bounded across a scope.",
  },
  {
    id: "sync-document-crosses-structural-barrier",
    module: "formal/document-sync/SyncLaneConcurrency.tla",
    config: "formal/document-sync/SyncLaneConcurrency.cfg",
    constants: { EnforceBarrier: "FALSE" },
    expect: { kind: "invariant", name: "StructuralBarrier" },
    why: "A queued structural pass must precede new document passes.",
  },
  {
    id: "sync-restarts-occupied-lane",
    module: "formal/document-sync/SyncLaneConcurrency.tla",
    config: "formal/document-sync/SyncLaneConcurrency.cfg",
    constants: { EnforceExclusivity: "FALSE" },
    expect: { kind: "invariant", name: "ExclusiveLane" },
    why: "A watchdog-abandoned callback still owns its lane until settlement.",
  },
  {
    id: "sync-completion-drops-trailing-request",
    module: "formal/document-sync/SyncLaneConcurrency.tla",
    config: "formal/document-sync/SyncLaneConcurrency.cfg",
    constants: { PreserveTrailing: "FALSE" },
    expect: { kind: "action", name: "TrailingRequestSurvives" },
    why: "A request arriving during a callback must survive its completion.",
  },
  {
    id: "sync-backoff-stalls-healthy-lanes",
    module: "formal/document-sync/SyncLaneConcurrency.tla",
    config: "formal/document-sync/SyncLaneConcurrency.cfg",
    constants: { IsolateBackoff: "FALSE" },
    expect: { kind: "invariant", name: "BackoffIsLocal" },
    why: "A failing document cannot make healthy document workers unavailable.",
  },
];
