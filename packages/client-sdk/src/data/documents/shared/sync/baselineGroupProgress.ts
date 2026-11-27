import {
  extendDocumentBaselineSegmentsDigest,
  startDocumentBaselineSegmentsDigest,
} from "@tearleads/crypto";
import { emptyVersionVector, versionVectorsEqual } from "@tearleads/loro";
import type { DocumentSyncResponse } from "@tearleads/validators/response";
import { readRecordString } from "../readers";
import {
  type BaselineGroupEvent,
  type BaselineGroupFault,
  type BaselineGroupRun,
  type BaselineGroupState,
  type BaselineSegmentChain,
  baselineGroupRunOf,
  baselineGroupStateFromRun,
  baselineGroupTransition,
  continuesWholeBaselineGroup,
} from "./baselineGroupMachine";
import {
  carriedUnappliedOperations,
  type UnappliedOperations,
  unappliedOperationsOf,
  unappliedSegmentsDeclared,
  withUnappliedSegment,
} from "./baselineGroupUnapplied";
import { isolateDocumentSyncBatchError } from "./documentSyncUpdateIsolation";
import type { VoidedDocumentSyncUpdate } from "./documentUpdateVerdict";

type SyncResponseUpdate = DocumentSyncResponse["updates"][number];

const FAULT_MESSAGES: Record<BaselineGroupFault, string> = {
  count_mismatch:
    "a rotation baseline's final segment signs a count that does not fit its index",
  digest_mismatch:
    "a rotation baseline's final segment signs another digest than its served segments have",
  final_missing:
    "the pull ended inside a rotation baseline, before its final segment",
  first_missing:
    "a rotation baseline was served from past its first segment to a reader that asked for every update",
  group_interrupted:
    "another update was served between a rotation baseline's segments",
  mixed_baseline:
    "a segment of another rotation baseline was served inside one",
  segment_out_of_order:
    "a rotation baseline's segments were not served in index order",
};

function isEmptyVersion(localVersionVector: string | null): boolean {
  if (localVersionVector === null) return true;
  try {
    return versionVectorsEqual(localVersionVector, emptyVersionVector());
  } catch {
    return false;
  }
}

/**
 * Whether a page was requested cold: with no version, so the server leaves
 * no update in its range out. A pull's first page is cold when it also
 * names no processed cursor. A later page is cold only as the continuation
 * of a group followed whole, which the pass requests with no version
 * (`pullPageRequest`); what a host put in a later page's version is not
 * taken as a reason to hold the server to a whole group. Whether `run` is
 * such a group is the machine's to say (`continuesWholeBaselineGroup`), as
 * it is for the request. Every page of a raw-history pull is cold: the pass
 * sends none of them a version or a processed cursor, so each group it
 * reaches is served whole.
 */
export function isColdPullPage(input: {
  readonly historyMode?: "raw" | undefined;
  readonly localVersionVector: string | null;
  readonly processedThroughUpdateId?: string | undefined;
  readonly pullCursor?: string | undefined;
  readonly run: BaselineGroupRun | null | undefined;
}): boolean {
  if (!isEmptyVersion(input.localVersionVector)) return false;
  if (input.historyMode === "raw") return true;
  return input.pullCursor === undefined
    ? input.processedThroughUpdateId === undefined
    : continuesWholeBaselineGroup(baselineGroupStateFromRun(input.run));
}

/** The fault message a failed pass reports. */
function servedBaselineGroupError(
  reason: string,
  updateIds: readonly string[],
) {
  return isolateDocumentSyncBatchError({
    cause: new Error(
      `Document sync response is not a whole rotation baseline: ${reason}`,
    ),
    stage: "baseline_group",
    updateIds,
  });
}

/**
 * The digests around a segment, when the reader holds the one before it: a
 * group's first segment starts from the group's own digest, and the next
 * segment of a run followed whole continues the run's.
 */
async function segmentChain(input: {
  readonly documentId: string;
  readonly follow: boolean;
  readonly state: BaselineGroupState;
  readonly update: SyncResponseUpdate & { readonly baselineId: string };
}): Promise<BaselineSegmentChain | null> {
  const { state, update } = input;
  const index = update.baselineSegmentIndex ?? -1;
  const continuesRun =
    state.status === "whole" &&
    state.baselineId === update.baselineId &&
    state.nextIndex === index;
  if (index !== 0 && !continuesRun) return null;
  const before = continuesRun
    ? state.digest
    : await startDocumentBaselineSegmentsDigest({
        baselineId: update.baselineId,
        documentId: input.documentId,
      });
  // A final segment is not in its own digest, and a group this pull will
  // not follow whole needs no digest past its start.
  if (update.baselineSegmentCount !== undefined || !input.follow) {
    return { after: null, before };
  }
  return {
    after: await extendDocumentBaselineSegmentsDigest(before, {
      ciphertextHash: readRecordString(
        update.writeHeader,
        "ciphertextHash",
        "write header",
      ),
      metadataHash: readRecordString(
        update.writeHeader,
        "metadataHash",
        "write header",
      ),
      segmentIndex: index,
      updateId: update.id,
    }),
    before,
  };
}

async function eventFor(input: {
  readonly cold: boolean;
  readonly documentId: string;
  readonly state: BaselineGroupState;
  readonly update: SyncResponseUpdate;
}): Promise<BaselineGroupEvent> {
  const { baselineId } = input.update;
  if (baselineId === undefined) return { type: "ordinary_update" };
  const update = { ...input.update, baselineId };
  const { baselineSegmentCount, baselineSegmentsDigest } = update;
  return {
    baselineId,
    chain: await segmentChain({
      documentId: input.documentId,
      follow: input.cold || input.state.status === "whole",
      state: input.state,
      update,
    }),
    cold: input.cold,
    index: update.baselineSegmentIndex ?? -1,
    seal:
      baselineSegmentCount === undefined || baselineSegmentsDigest === undefined
        ? null
        : { count: baselineSegmentCount, digest: baselineSegmentsDigest },
    type: "segment",
  };
}

/**
 * Hold the rotation baselines among a page's served updates to their group
 * rules, and return the run to carry to the pull's next page, if the page
 * ends inside a group it follows whole. `run` is what the page before it
 * carried. A group that breaks a rule fails the pass: no update is to blame
 * for the order or number of updates a server served, so it is never a void,
 * and the reader imports nothing from the page.
 *
 * The updates must already be authenticated: their baseline fields are the
 * ones their signed metadata hash covers, and their write headers carry the
 * hashes the digest is made of.
 */
export async function judgeServedBaselineGroups(input: {
  /** Whether the page was requested cold (`isColdPullPage`). */
  readonly cold: boolean;
  readonly documentId: string;
  /** Whether the server reported no further page. */
  readonly pullComplete: boolean;
  readonly run: BaselineGroupRun | null | undefined;
  readonly updates: readonly SyncResponseUpdate[];
}): Promise<BaselineGroupRun | null> {
  const { cold } = input;
  let state = baselineGroupStateFromRun(input.run);
  for (const update of input.updates) {
    state = baselineGroupTransition(
      state,
      await eventFor({ cold, documentId: input.documentId, state, update }),
    );
    if (state.status === "failed") break;
  }
  if (input.pullComplete) {
    state = baselineGroupTransition(state, { type: "pull_complete" });
  }
  if (state.status === "failed") {
    throw servedBaselineGroupError(
      FAULT_MESSAGES[state.fault],
      input.updates.map((update) => update.id),
    );
  }
  const next = baselineGroupRunOf(state);
  // A page that goes on inside the group it began in keeps what the pull
  // already knows of it; the page's own verdicts are added once judged.
  return next && input.run && input.run.baselineId === next.baselineId
    ? { ...next, unapplied: input.run.unapplied }
    : next;
}

/**
 * Hold a page's verdicts to what a served rotation baseline allows, and
 * return the run to carry to the pull's next page.
 *
 * The API commits a baseline only when each segment starts where the ones
 * before it end and depends on nothing outside them, and it leaves a segment
 * out of a page only when the reader's version holds its operations. So a
 * reader always holds what a served segment builds on: from before, or from
 * the segments served ahead of it. A segment that cannot join for want of
 * such an operation was served without the segments it builds on. That is
 * the server's doing and fails the pass; recording it void would outlast the
 * server's correction.
 *
 * Unless every operation it lacks is one that a segment of the same group,
 * served earlier in this pull and not accepted, declared. Then its writer
 * signed a segment no reader takes, this one builds on nothing for every
 * reader alike, and it is void as any update that follows a void one is.
 * What it declares is unapplied in turn. An unapplied segment excuses no
 * other operation: a server that leaves out a segment the reader lacks does
 * not turn the omission into a void by serving a void segment first.
 * `run.unapplied` carries the declared operations across pages. A group
 * whose unapplied segments name more peers than a run lists is taken as one
 * whose every operation was declared (`EVERY_OPERATION_UNAPPLIED`): the
 * pass goes on, and the segments of that group that cannot join are void.
 */
export function settleBaselineGroupVerdicts(input: {
  /** The served updates the page applies. */
  readonly appliedUpdateIds: ReadonlySet<string>;
  /** The run the machine left for the next page. */
  readonly nextRun: BaselineGroupRun | null;
  /** The run the page began with. */
  readonly run: BaselineGroupRun | null | undefined;
  readonly updates: readonly SyncResponseUpdate[];
  /**
   * The page's voids. One judged for want of a held operation names the
   * operations it lacked (`missingOperations`).
   */
  readonly voided: readonly Pick<
    VoidedDocumentSyncUpdate,
    "missingOperations" | "updateId"
  >[];
}): BaselineGroupRun | null {
  const none: UnappliedOperations = new Map();
  const missingById = new Map(
    input.voided.map((entry) => [entry.updateId, entry.missingOperations]),
  );
  const unapplied = new Map<string, UnappliedOperations>(
    input.run
      ? [[input.run.baselineId, unappliedOperationsOf(input.run.unapplied)]]
      : [],
  );
  for (const update of input.updates) {
    const { baselineId, id } = update;
    if (baselineId === undefined) continue;
    const declared = unapplied.get(baselineId) ?? none;
    const missing = missingById.get(id);
    if (missing && !unappliedSegmentsDeclared(declared, missing)) {
      throw servedBaselineGroupError(
        "a rotation baseline's segment was served without the segments it builds on",
        input.updates.map((served) => served.id),
      );
    }
    if (!input.appliedUpdateIds.has(id)) {
      unapplied.set(baselineId, withUnappliedSegment(declared, update));
    }
  }
  const { nextRun } = input;
  if (!nextRun) return null;
  // The run is carried in memory and stored with the continuation, so what
  // it lists is bounded: past the bound it carries every operation.
  return {
    ...nextRun,
    unapplied: carriedUnappliedOperations(
      unapplied.get(nextRun.baselineId) ?? none,
    ),
  };
}
