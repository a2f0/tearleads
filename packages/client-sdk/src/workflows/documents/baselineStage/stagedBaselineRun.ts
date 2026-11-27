import { startDocumentBaselineSegmentsDigest } from "@tearleads/crypto";
import type { HistorySegmentSizes } from "@tearleads/loro";
import { isDocumentBaselineStageErrorCode } from "@tearleads/validators/response";
import { MAX_DOCUMENT_STAGED_BASELINE_SEGMENTS } from "@tearleads/validators/util";
import type {
  DocumentBaselineStageApi,
  DocumentBaselineStageFailure,
} from "../../../data/documents/shared/sync/baselineStageApi";
import { isDocumentSyncRequestLimitError } from "../../../data/documents/shared/sync/documentSyncOutgoingBatch";
import type { DocumentSyncPreparedUpdate } from "../../../data/documents/shared/sync/documentSyncTypes";
import {
  type DocumentSyncTraceEmitter,
  traceBaselineStage,
} from "../sync/syncTrace";
import {
  continueRotationBaselineEncoder,
  type EncodedBaselineSegment,
  type RotationBaselineEncoder,
  type RotationBaselineKeying,
  stagedSegmentMatchesHistory,
  stagedSegmentRecord,
} from "./rotationBaselineEncoder";
import {
  DocumentRotationBaselineLimitError,
  DocumentRotationBaselineStageError,
  DocumentRotationBaselineStageLimitError,
} from "./rotationBaselineErrors";
import {
  type RotationBaselineSigner,
  resignStagedSegmentHeader,
} from "./rotationBaselineSigner";
import type { RotationHistory } from "./rotationHistory";
import { stagedBaselineRefusalEvent } from "./stagedBaselineMachine";
import { openPastOrphanedStages } from "./stagedBaselineOrphans";
import {
  type StagedBaselineAbandonReason,
  type StagedBaselineState,
  stagedSegmentCount,
} from "./stagedBaselineState";
import {
  dropStagedBaselineUpload,
  type StagedBaselineUpload,
  type StagedBaselineUploads,
} from "./stagedBaselineUploads";

/** What every run of an upload is given. */
export interface StagedBaselineRunContext {
  readonly api: DocumentBaselineStageApi;
  /** The author's processed cursor, which the final segment signs. */
  readonly coversThroughUpdateId: string | undefined;
  readonly history: RotationHistory;
  readonly keying: RotationBaselineKeying;
  readonly onTrace?: DocumentSyncTraceEmitter | undefined;
  readonly segmentSizes: HistorySegmentSizes | undefined;
  readonly signer: RotationBaselineSigner;
  readonly stillCurrent?: (() => boolean) | undefined;
  readonly uploads: StagedBaselineUploads;
}

/**
 * One run of an upload: the effects of the machine's states until the final
 * segment is ready, the stage is lost, or the writer stops wanting it.
 */
export interface StagedBaselineRun {
  /** The attempt every event of this run is tagged with. */
  readonly attempt: number;
  readonly context: StagedBaselineRunContext;
  /** Cuts and encrypts the segments after the staged ones. */
  encoder: RotationBaselineEncoder | null;
  /** The final segment, once the history is spent. */
  final: DocumentSyncPreparedUpdate | null;
  /** The id of a new baseline whose first segments wait in `queue`. */
  plannedBaselineId: string | null;
  /** Segments encrypted before the stage opened, staged first. */
  readonly queue: EncodedBaselineSegment[];
  readonly upload: StagedBaselineUpload;
}

export type StagedBaselineRunResult =
  /** The final segment is ready for the request that rotates. */
  | {
      readonly attempt: number;
      readonly baselineStageId: string;
      readonly final: DocumentSyncPreparedUpdate;
      readonly kind: "committing";
      readonly upload: StagedBaselineUpload;
    }
  /** No stage stands and nothing staged is kept: the writer plans again. */
  | { readonly kind: "restart" }
  /** The writer stopped wanting the upload; its stage stands. */
  | { readonly kind: "cancelled" }
  /** A later run took the upload over; the upload is that run's now. */
  | { readonly kind: "superseded" };

/** Abandon reasons the same run recovers from by planning again. */
const RESTARTABLE: ReadonlySet<StagedBaselineAbandonReason> = new Set([
  "group_invalid",
  "history_diverged",
  "id_conflict",
  "segment_conflict",
  "segment_invalid",
]);

function requestOptions(run: StagedBaselineRun) {
  return {
    expectedPaymentRequiredOrganizationId: run.context.keying.organizationId,
    reportErrors: false,
    stillCurrent: run.context.stillCurrent,
  };
}

/** Refusals that ask the caller to come back: a timeout, and a throttle. */
const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([408, 429]);

/**
 * Whether a failed stage request says nothing about the upload: it got no
 * answer, the API failed, or the API asked the writer to come back later.
 * The stage is then left for the next run. Any other refusal without a
 * stage code is one a retry would meet again: access and billing (`403`,
 * `402`), a request the API will not take (`400`, `413`), and the
 * document's own refusal, an uncoded `409`, which a stage route sends when
 * the document is gone or takes no write as it stands.
 */
function saysNothing(failure: DocumentBaselineStageFailure): boolean {
  const { status } = failure;
  return status === null || status >= 500 || TRANSIENT_STATUSES.has(status);
}

/**
 * Whether `run` is still the document's live upload and its current run:
 * neither another attempt of this upload nor a replacement upload for a
 * different key has taken the document over.
 */
function isCurrent(run: StagedBaselineRun): boolean {
  return (
    run.context.uploads.get(run.upload.documentId) === run.upload &&
    run.upload.state.attempt === run.attempt
  );
}

/**
 * A refused stage request. Its coded refusal moves the machine. Any other
 * failure ends the run: one the API gave on purpose gives the upload up,
 * and a stage the writer gives up is deleted, so it does not hold one of
 * the user's open stages until it expires.
 */
async function refuse(
  run: StagedBaselineRun,
  failure: DocumentBaselineStageFailure,
): Promise<void> {
  // The answer is to a run a later one took over: it is nobody's failure,
  // and the upload it would give up is the later run's.
  if (!isCurrent(run)) return;
  if (!isDocumentBaselineStageErrorCode(failure.code)) {
    if (!saysNothing(failure)) {
      run.upload.dispatch({ attempt: run.attempt, type: "released" });
      await dropStagedBaselineUpload(run.context, run.upload);
    }
    throw new DocumentRotationBaselineStageError(
      failure.message,
      failure.code,
      failure.status,
    );
  }
  run.upload.dispatch(stagedBaselineRefusalEvent(failure.code, run.attempt));
}

async function openStage(
  run: StagedBaselineRun,
  state: Extract<StagedBaselineState, { status: "opening" }>,
): Promise<void> {
  const { plan } = run.upload;
  const { api, uploads } = run.context;
  // Save the stage identity, fresh key, and wrapped targets before opening
  // on the server so a crash after the POST can resume or replace safely.
  // If persistence fails, drop the in-memory upload too so no later attempt
  // skips persistence or assumes a stage exists.
  try {
    await uploads.persist(run.upload);
  } catch (error) {
    uploads.end(run.upload);
    throw error;
  }
  if (!isCurrent(run)) return;
  // A user who holds every open stage it may is told so only once the
  // stages nobody is filling are abandoned and the open has been refused
  // again.
  const result = await openPastOrphanedStages(
    () =>
      api.openDocumentBaselineStageResult(
        run.upload.documentId,
        {
          baselineId: state.baselineId,
          contentKeyCommitment: plan.contentKeyCommitment,
          contentKeyEpoch: plan.contentKeyEpoch,
        },
        requestOptions(run),
      ),
    { api, uploads },
  );
  if (!result.ok) return refuse(run, result);
  const { attempt } = run;
  // A new id names a new stage. One that already holds segments is another
  // upload's, and nothing of it is this writer's to commit.
  if (result.data.nextSegmentIndex !== 0) {
    run.upload.dispatch({ attempt, type: "segmentConflict" });
    return;
  }
  const signedFor = run.context.signer.identity;
  run.upload.dispatch({ attempt, signedFor, type: "stageOpened" });
}

/**
 * Read where the stage stands and keep only the records it acknowledges.
 * The stage must be the one this writer filled: for its key, holding no
 * more than the writer sent, with the digest the writer's records chain to.
 */
async function readStage(
  run: StagedBaselineRun,
  state: Extract<StagedBaselineState, { status: "resuming" }>,
): Promise<void> {
  const { documentId, plan } = run.upload;
  const result = await run.context.api.getDocumentBaselineStageResult(
    documentId,
    state.baselineId,
    requestOptions(run),
  );
  if (!result.ok) return refuse(run, result);
  const { attempt } = run;
  const stage = result.data;
  const digest =
    stage.nextSegmentIndex === 0
      ? await startDocumentBaselineSegmentsDigest({
          baselineId: state.baselineId,
          documentId,
        })
      : state.records[stage.nextSegmentIndex - 1]?.digestAfter;
  if (
    digest !== stage.segmentsDigest ||
    stage.contentKeyEpoch !== plan.contentKeyEpoch ||
    stage.contentKeyCommitment !== plan.contentKeyCommitment
  ) {
    run.upload.dispatch({ attempt, type: "stagedHistoryDiverged" });
    return;
  }
  run.upload.dispatch({
    attempt,
    nextSegmentIndex: stage.nextSegmentIndex,
    type: "stageRead",
  });
}

/**
 * Hold every staged segment to the history this run was given, then cut
 * what the history holds past them. A segment the history no longer gives,
 * or a history with nothing left for a final segment, ends the stage.
 */
async function confirmStaged(
  run: StagedBaselineRun,
  state: Extract<StagedBaselineState, { status: "confirming" }>,
): Promise<void> {
  const { attempt, context, upload } = run;
  const { history, keying } = context;
  run.queue.length = 0;
  for (const record of state.records) {
    if (!(await stagedSegmentMatchesHistory({ history, keying, record }))) {
      upload.dispatch({ attempt, type: "stagedHistoryDiverged" });
      return;
    }
  }
  run.encoder = await continueRotationBaselineEncoder({
    baselineId: state.baselineId,
    coversThroughUpdateId: context.coversThroughUpdateId,
    history,
    keying,
    segmentSizes: context.segmentSizes,
    staged: state.records,
  });
  if (run.encoder.peek() === null) {
    upload.dispatch({ attempt, type: "stagedHistoryDiverged" });
    return;
  }
  const signedFor = context.signer.identity;
  const next = upload.dispatch({
    attempt,
    signedFor,
    type: "stagedHistoryConfirmed",
  });
  if (isCurrent(run) && next.status === "resigningHeaders") {
    await context.uploads.persist(upload);
  }
}

async function resignHeader(
  run: StagedBaselineRun,
  state: Extract<StagedBaselineState, { status: "resigningHeaders" }>,
): Promise<void> {
  const { signer } = run.context;
  const segmentIndex = state.nextHeaderIndex;
  const record = state.records[segmentIndex];
  if (!record) throw new Error("A staged segment has no record to sign for");
  const writeHeader = await resignStagedSegmentHeader(signer, record);
  if (!isCurrent(run)) return;
  const result =
    await run.context.api.resignDocumentBaselineSegmentHeaderResult(
      run.upload.documentId,
      state.baselineId,
      segmentIndex,
      { writeHeader },
      requestOptions(run),
    );
  if (!result.ok) return refuse(run, result);
  const next = run.upload.dispatch({
    attempt: run.attempt,
    segmentIndex,
    signedFor: signer.identity,
    type: "headerResigned",
  });
  if (isCurrent(run) && next.status === "staging") {
    await run.context.uploads.persist(run.upload);
  }
}

/**
 * Take the next segment: the final one is kept for the request that
 * rotates, and any other is recorded, signed and uploaded. The record is
 * kept before the request goes out, so a lost answer leaves a record the
 * next run's read of the stage confirms or drops.
 */
async function stageNext(
  run: StagedBaselineRun,
  state: Extract<StagedBaselineState, { status: "staging" }>,
): Promise<void> {
  const { attempt, upload } = run;
  const segmentIndex = state.nextSegmentIndex;
  const segment =
    run.queue.shift() ?? (await run.encoder?.next({ smallFinal: true }));
  if (!segment) throw new Error("A rotation baseline has no final segment");
  if (segment.final) {
    run.final = segment.prepared;
    upload.dispatch({ attempt, segmentIndex, type: "finalSegmentReady" });
    return;
  }
  // The last index a baseline has is its final segment's.
  if (segmentIndex >= MAX_DOCUMENT_STAGED_BASELINE_SEGMENTS - 1) {
    upload.dispatch({ attempt, type: "segmentLimitExceeded" });
    return;
  }
  const signed = await run.context.signer
    .sign(segment.prepared)
    .catch(async (error: unknown) => {
      // A segment no request carries ends the upload, and its stage with it.
      if (isDocumentSyncRequestLimitError(error) && isCurrent(run)) {
        upload.dispatch({ attempt, type: "released" });
        await dropStagedBaselineUpload(run.context, upload);
      }
      throw error;
    });
  if (!isCurrent(run)) return;
  const record = stagedSegmentRecord(segment);
  upload.dispatch({ attempt, record, segmentIndex, type: "segmentSent" });
  // Persist the segment record before uploading so a crash after the server
  // stores the segment still has the record needed to confirm on resume.
  await run.context.uploads.persist(upload);
  if (!isCurrent(run)) return;
  const result = await run.context.api.stageDocumentBaselineSegmentResult(
    upload.documentId,
    state.baselineId,
    segmentIndex,
    signed,
    requestOptions(run),
  );
  if (!result.ok) return refuse(run, result);
  const staged =
    result.data.nextSegmentIndex === segmentIndex + 1 &&
    result.data.segmentsDigest === segment.digestAfter;
  // A stage that is not where this segment left it is read again.
  upload.dispatch(
    staged
      ? { attempt, segmentIndex, type: "segmentStaged" }
      : { attempt, type: "segmentOutOfOrder" },
  );
}

/** What an upload that is over means for the run that found it so. */
async function endRun(
  run: StagedBaselineRun,
  state: Extract<
    StagedBaselineState,
    { status: "abandoned" | "done" | "failed" }
  >,
): Promise<StagedBaselineRunResult> {
  await dropStagedBaselineUpload(run.context, run.upload);
  if (state.status === "failed") {
    throw state.reason === "open_stage_limit"
      ? new DocumentRotationBaselineStageLimitError()
      : new DocumentRotationBaselineLimitError(state.reason);
  }
  if (state.status === "abandoned" && RESTARTABLE.has(state.reason)) {
    return { kind: "restart" };
  }
  throw new DocumentRotationBaselineStageError(
    state.status === "abandoned"
      ? `Document rotation baseline stage was abandoned: ${state.reason}`
      : "Document rotation baseline stage was already committed",
    undefined,
    null,
  );
}

function trace(run: StagedBaselineRun, state: StagedBaselineState): void {
  traceBaselineStage(run.context.onTrace, {
    documentId: run.upload.documentId,
    segments: stagedSegmentCount(state),
    status: state.status,
  });
}

/** Run the state's effect; a result ends the run. */
async function step(
  run: StagedBaselineRun,
  state: StagedBaselineState,
): Promise<StagedBaselineRunResult | null> {
  switch (state.status) {
    case "planning": {
      // Nothing stands. A run that brought a new baseline opens its stage;
      // one whose stage was lost has nothing to go on with.
      const baselineId = run.plannedBaselineId;
      run.plannedBaselineId = null;
      if (baselineId === null) {
        await run.context.uploads.forget(run.upload);
        return { kind: "restart" };
      }
      run.upload.dispatch({
        attempt: run.attempt,
        baselineId,
        type: "planned",
      });
      return null;
    }
    case "opening":
      await openStage(run, state);
      return null;
    case "resuming":
      await readStage(run, state);
      return null;
    case "confirming":
      await confirmStaged(run, state);
      return null;
    case "resigningHeaders":
      await resignHeader(run, state);
      return null;
    case "staging":
      await stageNext(run, state);
      return null;
    case "committing": {
      if (!run.final) throw new Error("A committing upload has no final");
      const { attempt, upload } = run;
      const { baselineId: baselineStageId } = state;
      return {
        attempt,
        baselineStageId,
        final: run.final,
        kind: "committing",
        upload,
      };
    }
    case "appendingTail":
      // A run starts by reading the stage, so it never finds this state.
      throw new Error("A staged baseline run began without reading its stage");
    default:
      return endRun(run, state);
  }
}

/**
 * Drive `run.upload` from where it stands until its final segment is ready.
 * Only this run's attempt moves the machine, which owns the records of what
 * is staged: once a later run has started, this one's answers change
 * nothing and it stops without touching the stage again.
 */
export async function runStagedBaselineUpload(
  run: StagedBaselineRun,
): Promise<StagedBaselineRunResult> {
  let traced: string | null = null;
  for (;;) {
    const { state } = run.upload;
    // A later run — or a replacement upload for a fresh key — took over
    // while this one waited on a request. That run owns the document's
    // upload now, and this one ends without a word: a local race is not a
    // failure of the upload.
    if (!isCurrent(run)) return { kind: "superseded" };
    if (run.context.stillCurrent?.() === false) return { kind: "cancelled" };
    const progress = `${state.status}:${stagedSegmentCount(state) >> 4}`;
    if (progress !== traced) trace(run, state);
    traced = progress;
    const result = await step(run, state);
    if (result) return result;
  }
}
