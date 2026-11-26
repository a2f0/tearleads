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
} from "./baselineGroupMachine";
import { isolateDocumentSyncBatchError } from "./documentSyncUpdateIsolation";

type SyncResponseUpdate = DocumentSyncResponse["updates"][number];

const FAULT_MESSAGES: Record<BaselineGroupFault, string> = {
  count_mismatch:
    "a rotation baseline's final segment signs a count that does not fit its index",
  digest_mismatch:
    "a rotation baseline's final segment signs another digest than its served segments have",
  final_missing:
    "the pull ended inside a rotation baseline, before its final segment",
  group_interrupted:
    "another update was served between a rotation baseline's segments",
  mixed_baseline:
    "a segment of another rotation baseline was served inside one",
  segment_out_of_order:
    "a rotation baseline's segments were not served in index order",
};

/** Whether a pull sent with `localVersionVector` asked for every update. */
export function isColdPull(localVersionVector: string | null): boolean {
  if (localVersionVector === null) return true;
  try {
    return versionVectorsEqual(localVersionVector, emptyVersionVector());
  } catch {
    return false;
  }
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
  readonly documentId: string;
  /** The version vector the pull was sent with. */
  readonly localVersionVector: string | null;
  /** Whether the server reported no further page. */
  readonly pullComplete: boolean;
  readonly run: BaselineGroupRun | null | undefined;
  readonly updates: readonly SyncResponseUpdate[];
}): Promise<BaselineGroupRun | null> {
  const cold = isColdPull(input.localVersionVector);
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
    throw isolateDocumentSyncBatchError({
      cause: new Error(
        `Document sync response is not a whole rotation baseline: ${FAULT_MESSAGES[state.fault]}`,
      ),
      stage: "encrypted_record",
      updateIds: input.updates.map((update) => update.id),
    });
  }
  return baselineGroupRunOf(state);
}
