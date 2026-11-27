import type { NegativeControl } from "./protocolNegativeControlTypes";

const DOCUMENT_LISTING_MODULE =
  "formal/document-sync/DocumentListingConvergence.tla";
const DOCUMENT_LISTING_CONFIG =
  "formal/document-sync/DocumentListingConvergence.cfg";
const DOCUMENT_LISTING_PROBE_CONFIG =
  "formal/document-sync/DocumentListingConvergenceProbe.cfg";

const SHARED_DATABASE_MODULE = "formal/document-sync/SharedDatabaseListing.tla";
const SHARED_DATABASE_CONFIG = "formal/document-sync/SharedDatabaseListing.cfg";

const LANE_POLLING_MODULE = "formal/document-sync/DocumentLanePolling.tla";
const LANE_POLLING_CONFIG = "formal/document-sync/DocumentLanePolling.cfg";

const CATCH_UP_MODULE = "formal/document-sync/CatchUpCoordination.tla";
const CATCH_UP_CONFIG = "formal/document-sync/CatchUpCoordination.cfg";

export const DOCUMENT_LISTING_NEGATIVE_CONTROLS: readonly NegativeControl[] = [
  {
    id: "document-lane-write-without-folder-touch",
    module: LANE_POLLING_MODULE,
    config: LANE_POLLING_CONFIG,
    constants: { TouchFolderOnWrite: "FALSE" },
    expect: { kind: "invariant", name: "LaneEvidenceRetained" },
    why: "A catch-up lists only the document lanes whose container row a tree listing was served. A write that changes a lane without republishing its container, as a purge once did, leaves nothing to point at the lane when its hint is lost.",
  },
  {
    id: "document-lane-watermark-before-request",
    module: LANE_POLLING_MODULE,
    config: LANE_POLLING_CONFIG,
    constants: { OweBeforeParentWatermark: "FALSE" },
    expect: { kind: "invariant", name: "LaneEvidenceRetained" },
    why: "A tree listing that saves its lane's watermark past a container's row before owing that container's document lane a listing loses the only evidence the lane moved when the process stops in between.",
  },
  {
    id: "document-lane-settled-by-older-listing",
    module: LANE_POLLING_MODULE,
    config: LANE_POLLING_CONFIG,
    constants: { SettleOnlyIfUnchanged: "FALSE" },
    expect: { kind: "invariant", name: "LaneEvidenceRetained" },
    why: "A listing already in flight when a tree listing was served the container's row may have been answered before the write behind that row. It must not settle the request the row caused.",
  },
  {
    id: "document-lane-forgets-durable-request",
    module: LANE_POLLING_MODULE,
    config: LANE_POLLING_CONFIG,
    constants: { ListDurableDebts: "FALSE" },
    expect: { kind: "liveness", name: "Converges" },
    why: "A request written before a crash names a lane whose container row the next tree listing is not served again, because the watermark already passed it. A catch-up that lists only what its own crawl owed never lists that lane.",
  },
  {
    id: "document-lane-settles-failed-listing",
    module: LANE_POLLING_MODULE,
    config: LANE_POLLING_CONFIG,
    constants: { SettleOnFailedListing: "TRUE" },
    expect: { kind: "invariant", name: "LaneEvidenceRetained" },
    why: "A failed or incomplete document-lane listing does not advance the lane watermark. Settling its durable debt anyway loses the only evidence of the change once the parent lane watermark has passed.",
  },
  {
    id: "shared-database-listing-reads-debts-only",
    module: SHARED_DATABASE_MODULE,
    config: SHARED_DATABASE_CONFIG,
    constants: { PullWhenSavedElsewhere: "FALSE" },
    expect: { kind: "invariant", name: "OpenCopyEvidenceRetained" },
    why: "Two tabs on one database share the lane watermark and the listing debt. A tab that reconnects after the other one listed the row, read the edit and settled the debt finds nothing owed, and its open copy stays the older one unless the catch-up also compares it with the saved record.",
  },
  {
    id: "shared-database-listing-drops-failed-catchup",
    module: SHARED_DATABASE_MODULE,
    config: SHARED_DATABASE_CONFIG,
    constants: { AskWhenListingFails: "FALSE" },
    expect: { kind: "invariant", name: "OpenCopyEvidenceRetained" },
    why: "A runtime whose catch-up listing fails must leave the lane uncovered and still run the catch-up ask; dropping the failed catch-up leaves a stale open copy with nothing obliging a read.",
  },
  {
    id: "document-listing-watermark-before-debt",
    module: DOCUMENT_LISTING_MODULE,
    config: DOCUMENT_LISTING_CONFIG,
    constants: { OweBeforeWatermark: "FALSE" },
    expect: { kind: "invariant", name: "EvidenceRetained" },
    why: "A listing that advances the lane watermark past a document's row before owing its read loses the only evidence of a lost hint when the process stops in between: no store probes the document on its own.",
  },
  {
    id: "document-listing-settles-lagging-read",
    module: DOCUMENT_LISTING_MODULE,
    config: DOCUMENT_LISTING_CONFIG,
    constants: { SettleOnlyIfCovered: "FALSE" },
    expect: { kind: "invariant", name: "EvidenceRetained" },
    why: "A pull served by a replica that lags the listing can complete without the edit; settling the debt on it leaves an unread update that nothing will list again.",
  },
  {
    id: "document-listing-applies-before-debt",
    module: DOCUMENT_LISTING_MODULE,
    config: DOCUMENT_LISTING_CONFIG,
    constants: { OweBeforeApply: "FALSE" },
    expect: { kind: "invariant", name: "AccessHeadEvidenceRetained" },
    why: "Applying a listed row whose access head is newer drops the key bundle the record held. A debt checked only afterwards finds no head to compare, so an open store keeps the access context of the older head and nothing lists the row again.",
  },
  {
    id: "document-listing-settles-stale-read",
    module: DOCUMENT_LISTING_MODULE,
    config: DOCUMENT_LISTING_CONFIG,
    // Without head moves, hint-forced listings, or lagging replicas so the
    // hinted edit is the only thing the stale read loses.
    constants: {
      HintListsLane: "FALSE",
      MaxHeadMoves: "0",
      MaxLaggingReads: "0",
      SettleOnlyIfUnchanged: "FALSE",
    },
    expect: { kind: "liveness", name: "Converges" },
    why: "A read that started before a peer's hinted edit must not clear that hint with its older snapshot.",
  },
  {
    id: "document-listing-hint-without-lane-listing",
    module: DOCUMENT_LISTING_MODULE,
    config: DOCUMENT_LISTING_CONFIG,
    // Without head moves so the hinted edit answered by a lagging replica is
    // isolated from head-move recovery.
    constants: { HintListsLane: "FALSE", MaxHeadMoves: "0" },
    expect: { kind: "liveness", name: "Converges" },
    why: "A hinted read answered by a lagging replica carries no durable debt on its own; without the hint also forcing a lane listing, the client stays behind until the next acknowledged connection.",
  },
  {
    id: "document-listing-settles-debt-with-older-read",
    module: DOCUMENT_LISTING_MODULE,
    config: DOCUMENT_LISTING_CONFIG,
    // Without lagging replicas, so the read in flight is the only stale one,
    // and without the head guard, which refuses that read on its own.
    constants: {
      MaxLaggingReads: "0",
      SettleOnlyIfHeadRead: "FALSE",
      SettleOnlyIfUnchanged: "FALSE",
    },
    expect: { kind: "invariant", name: "AccessHeadEvidenceRetained" },
    why: "A read that started before the access head moved must not settle the debt a later listing owed for that move: its snapshot predates the head, and the watermark already passed the row. The revision it saw refuses it, and so does the head its bundle carries; with neither, the move is lost.",
  },
  {
    id: "document-listing-settles-lagging-head",
    module: DOCUMENT_LISTING_MODULE,
    config: DOCUMENT_LISTING_CONFIG,
    constants: { SettleOnlyIfHeadRead: "FALSE" },
    expect: { kind: "invariant", name: "AccessHeadEvidenceRetained" },
    why: "A replica that lags the listing can answer a pull begun after the debt with the access head from before the move. Its revision is current and its cursor may cover the count, so only the head its bundle carries shows the move was not read.",
  },
  {
    id: "document-listing-drops-closed-store-hint",
    module: DOCUMENT_LISTING_MODULE,
    config: DOCUMENT_LISTING_CONFIG,
    // Isolate a host that does not route hints to lane listings.
    constants: {
      HintListsLane: "FALSE",
      MaxLaggingReads: "0",
      RememberClosedStoreHint: "FALSE",
    },
    expect: { kind: "liveness", name: "Converges" },
    why: "A hint that names a document with no loaded store reaches nothing, and a covered store arms no probe when it loads, so the edit waits for the next connection's listing.",
  },
  {
    id: "document-listing-forgets-durable-debt",
    module: DOCUMENT_LISTING_MODULE,
    config: DOCUMENT_LISTING_CONFIG,
    constants: { RestoreOnOpen: "FALSE" },
    expect: { kind: "liveness", name: "Converges" },
    why: "A debt written before a crash, or before the document's store opened, is never read if a loading store does not look for it, because the lane watermark already passed the row.",
  },
  {
    id: "document-listing-no-relist-after-ack",
    module: DOCUMENT_LISTING_MODULE,
    config: DOCUMENT_LISTING_CONFIG,
    constants: { RelistOnAcknowledge: "FALSE" },
    expect: { kind: "liveness", name: "Converges" },
    why: "An edit whose hint was lost while disconnected or closed is found only by the listing that follows an acknowledged connection.",
  },
  {
    id: "document-listing-probe-debt-unasked",
    module: DOCUMENT_LISTING_MODULE,
    config: DOCUMENT_LISTING_PROBE_CONFIG,
    constants: { ProbeAsksOpenStore: "FALSE" },
    expect: { kind: "liveness", name: "DebtsSettle" },
    why: "The launch probe owes a read for a head that moved while the client stayed connected. Its store is already open and no re-list follows, so a debt it does not also ask that store to read waits for the next connection or restart.",
  },
  {
    id: "document-listing-lagging-listing-lowers-debt",
    module: DOCUMENT_LISTING_MODULE,
    config: DOCUMENT_LISTING_PROBE_CONFIG,
    constants: { KeepHigherDebt: "FALSE" },
    expect: { kind: "invariant", name: "AccessHeadEvidenceRetained" },
    why: "A lagging listing that overwrites a stronger durable debt with an older advertised head lets a lagging pull settle the debt while the head move remains unread past the watermark.",
  },
  {
    id: "document-listing-skips-probe-without-bundle",
    module: DOCUMENT_LISTING_MODULE,
    config: DOCUMENT_LISTING_PROBE_CONFIG,
    constants: { ProbeWithoutBundle: "FALSE" },
    expect: { kind: "invariant", name: "AccessHeadEvidenceRetained" },
    why: "An unpulled record that holds no key bundle is not covered by listings; skipping its startup probe on open leaves it without an access context.",
  },
  {
    id: "document-listing-skips-withheld-cursor",
    module: DOCUMENT_LISTING_MODULE,
    config: DOCUMENT_LISTING_PROBE_CONFIG,
    // Isolate withheld-cursor probing on open from head moves, lagging reads,
    // failed listings, and launch probes.
    constants: {
      LaunchProbe: "FALSE",
      MaxHeadMoves: "0",
      MaxLaggingReads: "0",
      MaxListFailures: "0",
      ProbeWithheldCursor: "FALSE",
      StartWithoutBundle: "FALSE",
    },
    expect: { kind: "liveness", name: "WithheldCursorSettles" },
    why: "A record whose processed cursor became withheld between sessions sits behind the lane watermark; if opening its store does not probe, the withheld cursor is never replaced.",
  },
  {
    id: "document-listing-advances-watermark-on-failed-listing",
    module: DOCUMENT_LISTING_MODULE,
    config: DOCUMENT_LISTING_PROBE_CONFIG,
    constants: { AdvanceOnFailedListing: "TRUE" },
    expect: { kind: "invariant", name: "EvidenceRetained" },
    why: "A listing that fails or is paused before owing its reads must never advance the lane watermark; advancing it anyway drops unread edits behind the watermark.",
  },
  {
    id: "catch-up-vouch-across-ack",
    module: CATCH_UP_MODULE,
    config: CATCH_UP_CONFIG,
    constants: { CheckAckOnListed: "FALSE" },
    expect: { kind: "invariant", name: "VouchIsFresh" },
    why: "A listing started before a second acknowledgement that the wait shares may have missed writes made while the socket was down; counting it for fallback vouching skips a stale lane.",
  },
  {
    id: "catch-up-vouch-stale-pending-gen",
    module: CATCH_UP_MODULE,
    config: CATCH_UP_CONFIG,
    constants: { CheckPendingGenOnListed: "FALSE" },
    expect: { kind: "invariant", name: "VouchIsFresh" },
    why: "An older concurrent listing batch started before pendingDiscovery must not re-add the lane to listedSinceContainerIds and let the incomplete-crawl fallback swallow its pending retry.",
  },
  {
    id: "catch-up-overdue-still-defers",
    module: CATCH_UP_MODULE,
    config: CATCH_UP_CONFIG,
    constants: { OverdueEndsDeferral: "FALSE" },
    expect: { kind: "liveness", name: "DeferralEnds" },
    why: "If a sweep ahead in line never releases its turn, failing to end deferral on turnOverdue leaves known lanes deferred forever.",
  },
  {
    id: "catch-up-stale-turn-ends-new-wait",
    module: CATCH_UP_MODULE,
    config: CATCH_UP_CONFIG,
    constants: { CheckWaitOnTurnTaken: "FALSE" },
    expect: { kind: "invariant", name: "ActiveWaitSurvivesStaleTurn" },
    why: "A superseded catch-up's late turnTaken must be ignored so it never resets a newer acknowledgement's active catch-up wait to idle.",
  },
];
