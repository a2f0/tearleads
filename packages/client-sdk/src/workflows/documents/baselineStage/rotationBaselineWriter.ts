import type { HistorySegmentSizes } from "@tearleads/loro";
import {
  DOCUMENT_SYNC_ERROR_CODES,
  isDocumentBaselineStageErrorCode,
} from "@tearleads/validators/response";
import { MAX_DOCUMENT_BASELINE_SEGMENTS } from "@tearleads/validators/util";
import {
  type DocumentBaselineStageApi,
  documentBaselineStageApi,
} from "../../../data/documents/shared/sync/baselineStageApi";
import {
  deriveDocumentContentKeyCommitment,
  openDocumentContentKey,
} from "../../../data/documents/shared/sync/contentKeyCommitment";
import { DocumentSyncRequestLimitError } from "../../../data/documents/shared/sync/documentSyncOutgoingBatch";
import type { DocumentSyncPreparedUpdate } from "../../../data/documents/shared/sync/documentSyncTypes";
import type { ExecSql } from "../../../data/sqlite/sqlSchema";
import { readProcessedCursorForVersion } from "../sync/processedCursor";
import type { DocumentSyncTraceEmitter } from "../sync/syncTrace";
import {
  type EncodedBaselineSegment,
  encodeEmptyRotationBaseline,
  startRotationBaselineEncoder,
} from "./rotationBaselineEncoder";
import { DocumentRotationBaselineStageError } from "./rotationBaselineErrors";
import type { RotationBaselineSigner } from "./rotationBaselineSigner";
import { openRotationHistory, type RotationHistory } from "./rotationHistory";
import { stagedBaselineRefusalEvent } from "./stagedBaselineMachine";
import {
  runStagedBaselineUpload,
  type StagedBaselineRunContext,
  type StagedBaselineRunResult,
} from "./stagedBaselineRun";
import type { StagedBaselineState } from "./stagedBaselineState";
import {
  dropStagedBaselineUpload,
  getOrCreateStagedBaselineUploads,
  type RotationKeyTarget,
  type StagedBaselinePlan,
  type StagedBaselineUpload,
  type StagedBaselineUploads,
} from "./stagedBaselineUploads";

/** How often one run plans again after it lost its stage. */
const MAX_RUN_RESTARTS = 1;

/** The final segment of a staged baseline, waiting on the rotating request. */
export interface StagedBaselineCommit {
  readonly api: DocumentBaselineStageApi;
  readonly attempt: number;
  readonly upload: StagedBaselineUpload;
  readonly uploads: StagedBaselineUploads;
}

/**
 * A rotation baseline ready for the request that rotates.
 *
 * - `none`: the history has no operation and its author no processed
 *   cursor, so there is nothing for a baseline to carry or cover.
 * - `inline`: the whole group, in index order, for one request.
 * - `staged`: every segment but the final one is uploaded; the request
 *   carries `final` and names the stage, and its answer goes to
 *   `settleStagedBaselineCommit`.
 * - `cancelled`: the writer stopped wanting the baseline.
 * - `superseded`: a later attempt took the document's upload over while
 *   this one waited on a request; the baseline is that attempt's to write.
 */
export type PreparedRotationBaseline =
  | { readonly kind: "none" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "superseded" }
  | {
      readonly kind: "inline";
      readonly segments: readonly DocumentSyncPreparedUpdate[];
    }
  | {
      readonly baselineStageId: string;
      readonly commit: StagedBaselineCommit;
      readonly kind: "staged";
      readonly segments: readonly [DocumentSyncPreparedUpdate];
    };

export interface RotationBaselineWriterInput {
  /** The API port; without its stage routes every baseline is sent whole. */
  readonly api: Partial<DocumentBaselineStageApi>;
  /** The fresh key the rotation opens, and its epoch. */
  readonly contentKey: Uint8Array;
  readonly contentKeyEpoch: number;
  readonly documentId: string;
  /** Reads the processed cursor and finds the document's upload. */
  readonly execSql: ExecSql | undefined;
  /**
   * The most base64 characters a group's payloads may total, with at most
   * 64 segments, to travel whole in the request that rotates. Zero stages
   * any history that has more than a final segment's worth.
   */
  readonly inlineCharacters: number;
  /**
   * Every target the request that rotates wraps `contentKey` for: its
   * content-key bundle's envelopes. A staged upload keeps them, and its key
   * goes on to a later attempt only for the exact same target set
   * (`reusableStagedBaselinePlan`).
   */
  readonly keyTargets: readonly RotationKeyTarget[];
  readonly onTrace?: DocumentSyncTraceEmitter | undefined;
  readonly organizationId: string;
  /** What a staged upload fixes for every attempt to commit it. */
  readonly plan: Pick<StagedBaselinePlan, "linkSetEvent" | "signedAt">;
  /** Names the caller in an error about its snapshot. */
  readonly purpose: string;
  readonly segmentSizes?: HistorySegmentSizes | undefined;
  readonly signer: RotationBaselineSigner;
  /** The full-history snapshot a rotation proof returned. */
  readonly snapshot: Uint8Array;
  readonly stillCurrent?: (() => boolean) | undefined;
}

/**
 * The plan a staged upload of `documentId` fixed, if a new attempt that
 * opens `contentKeyEpoch` and wraps its key for `keyTargets` may plan as
 * the upload did: with the same key, event id and signed time, so that
 * what is staged stays what the attempt signs for.
 *
 * It may only if the upload is still under way for that epoch and the
 * attempt's target set matches the targets the key was wrapped for exactly.
 * Shrinking the set would commit a key already sent to a container being
 * removed; expanding it would wrap a post-unlink key for the unlinked
 * container if a later heal ran against a stale projection. Any target-set
 * change therefore plans a new key, and the writer deletes the stage, whose
 * segments the old key encrypts.
 */
export async function reusableStagedBaselinePlan(
  execSql: ExecSql | undefined,
  documentId: string,
  contentKeyEpoch: number,
  keyTargets: readonly RotationKeyTarget[],
): Promise<StagedBaselinePlan | null> {
  const uploads = getOrCreateStagedBaselineUploads(execSql);
  await uploads.ensureLoaded();
  const upload = uploads.get(documentId);
  if (
    !upload?.isLiveAt(contentKeyEpoch) ||
    !upload.keyMayBeWrappedFor(keyTargets)
  ) {
    return null;
  }
  // The attempt wraps the key for these from here on, sent or not.
  upload.wrapKeyFor(keyTargets);
  return upload.plan;
}

function base64Characters(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

function prepared(
  result: StagedBaselineRunResult,
  context: StagedBaselineRunContext,
) {
  if (result.kind !== "committing") return result;
  const { attempt, baselineStageId, final, upload } = result;
  const { api, uploads } = context;
  return {
    baselineStageId,
    commit: { api, attempt, upload, uploads },
    kind: "staged",
    segments: [final],
  } as const;
}

interface WriterRun {
  readonly context: StagedBaselineRunContext | null;
  readonly input: RotationBaselineWriterInput;
  readonly plan: StagedBaselinePlan;
  readonly uploads: StagedBaselineUploads;
}

/**
 * A new baseline over the whole history. Segments are encrypted one at a
 * time and kept while the group can still travel whole. Once it cannot, a
 * stage opens, what was kept is uploaded, and the rest follows a segment at
 * a time.
 */
async function writeNewBaseline(
  run: WriterRun,
  encoderStart: Parameters<typeof startRotationBaselineEncoder>[0],
) {
  const { baselineId, encoder } =
    await startRotationBaselineEncoder(encoderStart);
  const kept: EncodedBaselineSegment[] = [];
  let characters = 0;
  for (;;) {
    const ahead = encoder.peek();
    if (
      !ahead ||
      kept.length >= MAX_DOCUMENT_BASELINE_SEGMENTS ||
      characters + base64Characters(ahead.bytes) > run.input.inlineCharacters
    ) {
      break;
    }
    const segment = await encoder.next({ smallFinal: false });
    if (!segment) break;
    kept.push(segment);
    characters += segment.prepared.encryptedData.length;
    if (segment.final) {
      const segments = kept.map((entry) => entry.prepared);
      return { kind: "inline", segments } as const;
    }
  }
  if (!run.context) {
    throw new DocumentSyncRequestLimitError(
      "Document rotation baseline does not fit one request and this client cannot stage it",
    );
  }
  const { documentId, keyTargets } = run.input;
  const upload = run.uploads.begin(documentId, run.plan, keyTargets);
  const { attempt } = upload.dispatch({ type: "runStarted" });
  return prepared(
    await runStagedBaselineUpload({
      attempt,
      context: run.context,
      encoder,
      final: null,
      plannedBaselineId: baselineId,
      queue: kept,
      upload,
    }),
    run.context,
  );
}

/**
 * Go on with the document's upload if it can still commit under this plan's
 * key, and otherwise write a new baseline. An upload for another key can
 * never commit, so its stage is given up first.
 *
 * The plan's key is the upload's only when `reusableStagedBaselinePlan`
 * handed it out, which holds the attempt to the exact target set the key
 * has gone to. The request's own envelopes are held to the same rule here,
 * where they are in hand: a key about to be wrapped for a different target
 * set than it went to is never sent, and its upload is given up.
 */
async function writeOnce(
  run: WriterRun,
  encoderStart: Parameters<typeof startRotationBaselineEncoder>[0],
) {
  const held = run.uploads.get(run.input.documentId);
  if (!held || !run.context) return writeNewBaseline(run, encoderStart);
  const sameKey = held.continues(run.plan);
  const { keyTargets } = run.input;
  if (!sameKey || !held.keyMayBeWrappedFor(keyTargets)) {
    held.dispatch({ attempt: held.state.attempt, type: "released" });
    await dropStagedBaselineUpload(run.context, held);
    if (!sameKey) return writeNewBaseline(run, encoderStart);
    throw new Error(
      "Document rotation key was planned for different targets than it was sent to",
    );
  }
  held.wrapKeyFor(keyTargets);
  const { attempt } = held.dispatch({ type: "runStarted" });
  return prepared(
    await runStagedBaselineUpload({
      attempt,
      context: run.context,
      encoder: null,
      final: null,
      plannedBaselineId: null,
      queue: [],
      upload: held,
    }),
    run.context,
  );
}

async function writeBaselineOf(
  history: RotationHistory,
  input: RotationBaselineWriterInput,
): Promise<PreparedRotationBaseline> {
  const { contentKey, contentKeyEpoch, documentId, organizationId } = input;
  // Updates the history's author voided need no coverage past its cursor.
  const coversThroughUpdateId = input.execSql
    ? await readProcessedCursorForVersion(input.execSql, {
        documentId,
        version: history.version,
      })
    : undefined;
  if (history.empty && coversThroughUpdateId === undefined) {
    return { kind: "none" };
  }
  const keying = {
    contentKey: await openDocumentContentKey(input),
    contentKeyEpoch,
    documentId,
    organizationId,
  };
  if (history.empty && coversThroughUpdateId !== undefined) {
    const empty = await encodeEmptyRotationBaseline({
      coversThroughUpdateId,
      keying,
    });
    return { kind: "inline", segments: [empty] };
  }
  const api = documentBaselineStageApi(input.api);
  const uploads = getOrCreateStagedBaselineUploads(input.execSql);
  await uploads.ensureLoaded();
  const { onTrace, segmentSizes, signer, stillCurrent } = input;
  const shared = { coversThroughUpdateId, history, keying, segmentSizes };
  const run: WriterRun = {
    context: api && { ...shared, api, onTrace, signer, stillCurrent, uploads },
    input,
    plan: {
      ...input.plan,
      contentKey,
      contentKeyCommitment: await deriveDocumentContentKeyCommitment(input),
      contentKeyEpoch,
    },
    uploads,
  };
  for (let restarts = 0; ; restarts += 1) {
    const result = await writeOnce(run, shared);
    if (result.kind !== "restart") return result;
    if (restarts >= MAX_RUN_RESTARTS) {
      throw new DocumentRotationBaselineStageError(
        "Document rotation baseline lost its stage twice while uploading",
        undefined,
        null,
      );
    }
  }
}

/**
 * Write the rotation baseline of a proven history for the request that
 * rotates. A group that fits one request is returned whole, exactly as
 * before staging existed, at no extra request. Any other history goes
 * through a stage: a new one, or the document's upload already under way,
 * which is confirmed against this history and continued where it stands.
 *
 * Never more than the kept inline candidate or two segments are held in
 * memory beside the snapshot: the history is exported, encrypted, signed
 * and uploaded one segment at a time.
 */
export async function writeRotationBaseline(
  input: RotationBaselineWriterInput,
): Promise<PreparedRotationBaseline> {
  const history = openRotationHistory(input);
  try {
    return await writeBaselineOf(history, input);
  } finally {
    history.free();
  }
}

/**
 * Give a staged upload up before its final segment is sent, and delete its
 * stage: the request that would commit it cannot be made. A later run that
 * took the upload over keeps it.
 */
export async function releaseStagedBaselineCommit(
  commit: StagedBaselineCommit,
): Promise<void> {
  const { attempt, upload, uploads } = commit;
  if (
    uploads.get(upload.documentId) !== upload ||
    upload.state.attempt !== attempt
  ) {
    return;
  }
  upload.dispatch({ attempt, type: "released" });
  await dropStagedBaselineUpload(commit, upload);
}

/** What the request that carried a staged baseline's final segment got. */
export type StagedBaselineCommitOutcome =
  | { readonly ok: true }
  | {
      readonly baselineStageCode?: string | undefined;
      readonly code?: string | undefined;
      /** The route's refusal of a group that stops short of the frontier. */
      readonly coverageCode: string;
      readonly ok: false;
      readonly status?: number | null | undefined;
    };

/**
 * Tell a staged upload how its commit went. An accepted commit ends it. A
 * coverage refusal leaves the stage for a tail, stale headers leave it to
 * be signed again, and a refusal that says the stage is gone or worthless
 * ends it; the stage is deleted where one may still stand. Any other
 * failure says nothing about the stage, which the next run reads.
 */
export async function settleStagedBaselineCommit(
  commit: StagedBaselineCommit,
  outcome: StagedBaselineCommitOutcome,
): Promise<StagedBaselineState> {
  const { attempt, upload } = commit;
  if (outcome.ok) {
    upload.dispatch({ attempt, type: "commitAccepted" });
  } else if (outcome.code === outcome.coverageCode) {
    upload.dispatch({ attempt, type: "coverageRefused" });
  } else if (outcome.code === DOCUMENT_SYNC_ERROR_CODES.baselineGroupInvalid) {
    upload.dispatch(
      isDocumentBaselineStageErrorCode(outcome.baselineStageCode)
        ? stagedBaselineRefusalEvent(outcome.baselineStageCode, attempt)
        : { attempt, type: "groupRefused" },
    );
  } else if (outcome.status === 402 || outcome.status === 403) {
    // The writer may no longer write the document: it gives the upload up.
    upload.dispatch({ attempt, type: "released" });
  }
  const { state } = upload;
  if (state.attempt === attempt) {
    if (
      state.status === "planning" ||
      state.status === "abandoned" ||
      state.status === "failed" ||
      state.status === "done"
    ) {
      await dropStagedBaselineUpload(commit, upload);
    } else if (state.status === "resigningHeaders") {
      await commit.uploads.persist(upload);
    }
  }
  return state;
}
