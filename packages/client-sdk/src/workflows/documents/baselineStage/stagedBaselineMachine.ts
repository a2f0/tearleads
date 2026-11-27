import {
  DOCUMENT_BASELINE_STAGE_ERROR_CODES,
  type DocumentBaselineStageErrorCode,
} from "@tearleads/validators/response";
import {
  type Filling,
  isStagedBaselineOver,
  MAX_STAGE_READS_PER_RUN,
  type StagedBaselineAbandonReason,
  type StagedBaselineEvent,
  type StagedBaselineFailureReason,
  type StagedBaselineState,
} from "./stagedBaselineState";

const REFUSAL_EVENT_TYPES = {
  [DOCUMENT_BASELINE_STAGE_ERROR_CODES.epochStale]: "stageEpochStale",
  [DOCUMENT_BASELINE_STAGE_ERROR_CODES.expired]: "stageExpired",
  [DOCUMENT_BASELINE_STAGE_ERROR_CODES.headersStale]: "headersStale",
  [DOCUMENT_BASELINE_STAGE_ERROR_CODES.idConflict]: "stageIdConflict",
  [DOCUMENT_BASELINE_STAGE_ERROR_CODES.limitReached]: "stageLimitReached",
  [DOCUMENT_BASELINE_STAGE_ERROR_CODES.notFound]: "stageNotFound",
  [DOCUMENT_BASELINE_STAGE_ERROR_CODES.segmentConflict]: "segmentConflict",
  [DOCUMENT_BASELINE_STAGE_ERROR_CODES.segmentInvalid]: "segmentInvalid",
  [DOCUMENT_BASELINE_STAGE_ERROR_CODES.segmentOutOfOrder]: "segmentOutOfOrder",
  [DOCUMENT_BASELINE_STAGE_ERROR_CODES.tooLarge]: "stageTooLarge",
} as const satisfies Record<
  DocumentBaselineStageErrorCode,
  StagedBaselineEvent["type"]
>;

/** The event a `document_baseline_stage_*` refusal raises. */
export function stagedBaselineRefusalEvent(
  code: DocumentBaselineStageErrorCode,
  attempt: number,
): StagedBaselineEvent {
  return { attempt, type: REFUSAL_EVENT_TYPES[code] };
}

type StagedState = Exclude<StagedBaselineState, { status: "planning" }>;
type FillingState = Extract<StagedState, Filling>;

/** The stage and what the writer remembers of it, carried between states. */
function filling(state: FillingState): Filling {
  const { attempt, baselineId, headersSignedFor, records } = state;
  return { attempt, baselineId, headersSignedFor, records };
}

/** As `filling`, for any state: a stage still opening holds nothing. */
function stageOf(state: StagedState): Filling {
  if ("records" in state) return filling(state);
  const { attempt, baselineId } = state;
  return { attempt, baselineId, headersSignedFor: null, records: [] };
}

/**
 * A new run. With no stage it plans; an upload that is over plans again;
 * anything else may have a stage standing, wherever its last run stopped,
 * so the run reads it before it relies on it.
 */
function startRun(state: StagedBaselineState): StagedBaselineState {
  const attempt = state.attempt + 1;
  if (state.status === "planning" || isStagedBaselineOver(state)) {
    return { attempt, status: "planning" };
  }
  return { ...stageOf(state), attempt, reads: 0, status: "resuming" };
}

function abandon(
  state: StagedState,
  reason: StagedBaselineAbandonReason,
  stageStands = state.status !== "opening",
): StagedBaselineState {
  const { attempt, baselineId } = state;
  return { attempt, baselineId, reason, stageStands, status: "abandoned" };
}

function fail(
  state: StagedState,
  reason: StagedBaselineFailureReason,
): StagedBaselineState {
  const { attempt, baselineId } = state;
  const stageStands = state.status !== "opening";
  return { attempt, baselineId, reason, stageStands, status: "failed" };
}

function staging(
  state: Filling,
  nextSegmentIndex: number,
  reads: number,
): StagedBaselineState {
  return { ...state, nextSegmentIndex, reads, status: "staging" };
}

/**
 * The stage was read. Only what it acknowledges is kept; a stage that holds
 * more than the writer sent is not the writer's.
 */
function afterRead(
  state: Extract<StagedState, { status: "resuming" }>,
  stagedSegments: number,
): StagedBaselineState {
  if (stagedSegments > state.records.length) {
    return abandon(state, "history_diverged");
  }
  return {
    ...filling(state),
    reads: state.reads + 1,
    records: state.records.slice(0, stagedSegments),
    stagedSegments,
    status: "confirming",
  };
}

/** The staged segments are the history's: re-sign them, or go on staging. */
function afterConfirmation(
  state: Extract<StagedState, { status: "confirming" }>,
  signedFor: string,
): StagedBaselineState {
  const { reads, stagedSegments } = state;
  if (stagedSegments === 0) {
    return staging(
      { ...filling(state), headersSignedFor: signedFor },
      0,
      reads,
    );
  }
  if (state.headersSignedFor === signedFor) {
    return staging(filling(state), stagedSegments, reads);
  }
  return {
    ...filling(state),
    headersSignedFor: null,
    nextHeaderIndex: 0,
    reads,
    stagedSegments,
    status: "resigningHeaders",
  };
}

function afterHeaderResigned(
  state: Extract<StagedState, { status: "resigningHeaders" }>,
  event: Extract<StagedBaselineEvent, { type: "headerResigned" }>,
): StagedBaselineState {
  if (event.segmentIndex !== state.nextHeaderIndex) return state;
  const nextHeaderIndex = event.segmentIndex + 1;
  return nextHeaderIndex < state.stagedSegments
    ? { ...state, nextHeaderIndex }
    : staging(
        { ...filling(state), headersSignedFor: event.signedFor },
        state.stagedSegments,
        state.reads,
      );
}

/** What the rotating request's answer does to an upload that awaits it. */
function settleCommit(
  state: Extract<StagedState, { status: "committing" }>,
  event: Extract<
    StagedBaselineEvent,
    { type: "commitAccepted" | "coverageRefused" | "headersStale" }
  >,
): StagedBaselineState {
  const { attempt, baselineId, finalSegmentIndex: stagedSegments } = state;
  switch (event.type) {
    case "commitAccepted":
      return { attempt, baselineId, status: "done" };
    case "coverageRefused":
      return { ...filling(state), stagedSegments, status: "appendingTail" };
    case "headersStale":
      return {
        ...filling(state),
        headersSignedFor: null,
        nextHeaderIndex: 0,
        reads: 0,
        stagedSegments,
        status: "resigningHeaders",
      };
  }
}

type StagedEvent = Exclude<
  StagedBaselineEvent,
  { type: "planned" | "runStarted" }
>;

/** The events that move an upload forward, each raised by one state. */
type ProgressEvent = Extract<
  StagedEvent,
  {
    type:
      | "commitAccepted"
      | "coverageRefused"
      | "finalSegmentReady"
      | "headerResigned"
      | "headersStale"
      | "segmentSent"
      | "segmentStaged"
      | "stagedHistoryConfirmed"
      | "stageOpened"
      | "stageRead";
  }
>;

const PROGRESS_EVENT_TYPES: ReadonlySet<StagedEvent["type"]> = new Set([
  "commitAccepted",
  "coverageRefused",
  "finalSegmentReady",
  "headerResigned",
  "headersStale",
  "segmentSent",
  "segmentStaged",
  "stagedHistoryConfirmed",
  "stageOpened",
  "stageRead",
]);

function isProgressEvent(event: StagedEvent): event is ProgressEvent {
  return PROGRESS_EVENT_TYPES.has(event.type);
}

/**
 * A segment is about to be sent, was staged, or the history is spent and
 * the next is final. Each counts only at the stage's next index, and a
 * segment is staged only once its record is kept.
 */
function afterSegment(
  state: Extract<StagedState, { status: "staging" }>,
  event: ProgressEvent,
): StagedBaselineState {
  if (
    (event.type !== "segmentSent" &&
      event.type !== "segmentStaged" &&
      event.type !== "finalSegmentReady") ||
    event.segmentIndex !== state.nextSegmentIndex
  ) {
    return state;
  }
  const { nextSegmentIndex, records } = state;
  if (event.type === "segmentSent") {
    return {
      ...state,
      records: [...records.slice(0, nextSegmentIndex), event.record],
    };
  }
  if (event.type === "segmentStaged") {
    return records.length === nextSegmentIndex + 1
      ? { ...state, nextSegmentIndex: nextSegmentIndex + 1 }
      : state;
  }
  return {
    ...filling(state),
    finalSegmentIndex: nextSegmentIndex,
    records: records.slice(0, nextSegmentIndex),
    status: "committing",
  };
}

/**
 * A step forward. Each state takes only the event its own effect raises, so
 * an answer that arrives for a state the upload has left changes nothing.
 */
function advance(
  state: StagedState,
  event: ProgressEvent,
): StagedBaselineState {
  switch (state.status) {
    case "opening": {
      if (event.type !== "stageOpened") return state;
      const { attempt, baselineId } = state;
      const opened = { attempt, baselineId, records: [] };
      return staging({ ...opened, headersSignedFor: event.signedFor }, 0, 0);
    }
    case "resuming":
      return event.type === "stageRead"
        ? afterRead(state, event.nextSegmentIndex)
        : state;
    case "confirming":
      return event.type === "stagedHistoryConfirmed"
        ? afterConfirmation(state, event.signedFor)
        : state;
    case "resigningHeaders":
      return event.type === "headerResigned"
        ? afterHeaderResigned(state, event)
        : state;
    case "staging":
      return afterSegment(state, event);
    case "committing":
      return event.type === "commitAccepted" ||
        event.type === "coverageRefused" ||
        event.type === "headersStale"
        ? settleCommit(state, event)
        : state;
    default:
      return state;
  }
}

/**
 * The stage is not where the writer thought: read it and go on from there.
 * A run reads only so often; a stage that still is not where its answers
 * put it is given up.
 */
function readAgain(state: StagedState): StagedBaselineState {
  const reads = "reads" in state ? state.reads : 0;
  return reads >= MAX_STAGE_READS_PER_RUN
    ? abandon(state, "stage_unsettled")
    : { ...stageOf(state), reads, status: "resuming" };
}

/** A refusal or a loss: the upload plans again, reads its stage, or ends. */
function setBack(
  state: StagedState,
  event: Exclude<StagedEvent, ProgressEvent>,
): StagedBaselineState {
  const { attempt } = state;
  switch (event.type) {
    case "stagedHistoryDiverged":
      return abandon(state, "history_diverged");
    case "segmentLimitExceeded":
      return fail(state, "segment_limit");
    case "stageTooLarge":
      return fail(state, "stage_too_large");
    // Refused at the open: the user's other stages fill every place.
    case "stageLimitReached":
      return fail(state, "open_stage_limit");
    case "groupRefused":
      return abandon(state, "group_invalid");
    // The stage is gone, so nothing staged is worth anything: plan again.
    case "stageNotFound":
    case "stageExpired":
      return { attempt, status: "planning" };
    case "stageEpochStale":
      return abandon(state, "epoch_stale");
    // An id taken before anything was staged costs only another id.
    case "stageIdConflict":
      return state.status === "opening"
        ? { attempt, status: "planning" }
        : abandon(state, "id_conflict");
    case "segmentOutOfOrder":
      return readAgain(state);
    case "segmentConflict":
      return abandon(state, "segment_conflict");
    case "segmentInvalid":
      return abandon(state, "segment_invalid");
    case "released":
      return abandon(state, "released");
  }
}

/**
 * The upload's next state. An event of another attempt, or one that reaches
 * an upload that is over, changes nothing: only the current run's effects
 * can finish.
 */
export function transitionStagedBaseline(
  state: StagedBaselineState,
  event: StagedBaselineEvent,
): StagedBaselineState {
  if (event.type === "runStarted") return startRun(state);
  if (event.attempt !== state.attempt || isStagedBaselineOver(state)) {
    return state;
  }
  if (state.status === "planning") {
    return event.type === "planned"
      ? {
          attempt: state.attempt,
          baselineId: event.baselineId,
          status: "opening",
        }
      : state;
  }
  if (event.type === "planned") return state;
  return isProgressEvent(event) ? advance(state, event) : setBack(state, event);
}
