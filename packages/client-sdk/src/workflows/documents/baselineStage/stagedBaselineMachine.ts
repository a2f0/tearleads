import {
  DOCUMENT_BASELINE_STAGE_ERROR_CODES,
  type DocumentBaselineStageErrorCode,
} from "@tearleads/validators/response";

/**
 * Why an upload gave up its stage. The next upload of the document plans
 * again: a new baseline id and a new stage.
 */
export type StagedBaselineAbandonReason =
  /** The document's content key moved past the stage's epoch. */
  | "epoch_stale"
  /** The API refused the group the final segment closes. */
  | "group_invalid"
  /** The proven history no longer gives the staged segments' bytes. */
  | "history_diverged"
  /** The baseline id is a committed baseline's or another user's stage. */
  | "id_conflict"
  /** The writer stopped wanting the upload. */
  | "released"
  /** The stage holds other bytes at an index or update id. */
  | "segment_conflict"
  /** The API refused a segment as one no baseline holds there. */
  | "segment_invalid";

/**
 * Why an upload cannot go on, whatever the writer does next:
 *
 * - `open_stage_limit`: the user holds as many open stages as the API lets
 *   one user hold. Nothing was opened; another upload has to end first.
 * - `segment_limit`: the history needs more segments than a baseline has.
 * - `stage_too_large`: the history needs more bytes or span rows than a
 *   stage stores.
 */
export type StagedBaselineFailureReason =
  | "open_stage_limit"
  | "segment_limit"
  | "stage_too_large";

interface Attempted {
  /**
   * The run of the upload this state belongs to. Every run starts a new
   * attempt, and only an event tagged with the state's attempt moves it, so
   * a request an earlier run left in flight cannot finish for a later one.
   */
  readonly attempt: number;
}

interface Staged extends Attempted {
  /** The stage's id, which every segment signs as its `baselineId`. */
  readonly baselineId: string;
}

/**
 * The upload of one rotation baseline through a stage, from the writer's
 * side (`docs/document-rotation-baselines.md`, "A Baseline Staged Ahead").
 *
 * - `planning`: nothing stands on the server; the run chooses a baseline id.
 * - `opening`: the stage is being opened.
 * - `resuming`: a stage may stand from an earlier run; the run reads where.
 * - `confirming`: the run checks that the history it was given still gives
 *   every staged segment's bytes.
 * - `resigningHeaders`: the staged headers name another manifest, target set
 *   or signing key than the request that will commit; each is signed again.
 * - `staging`: segment `nextSegmentIndex` is exported, encrypted, signed and
 *   uploaded, one at a time.
 * - `committing`: the final segment is with the request that rotates.
 * - `appendingTail`: that request was refused because the group stops short
 *   of the committed frontier. The stage stands, and the run that brings a
 *   longer proven history stages what was committed meanwhile.
 * - `done`, `abandoned`, `failed`: the upload is over.
 */
export type StagedBaselineState =
  | (Attempted & { readonly status: "planning" })
  | (Staged & { readonly status: "opening" })
  | (Staged & { readonly status: "resuming" })
  | (Staged & {
      readonly stagedSegments: number;
      readonly status: "confirming";
    })
  | (Staged & {
      readonly nextHeaderIndex: number;
      readonly stagedSegments: number;
      readonly status: "resigningHeaders";
    })
  | (Staged & {
      readonly nextSegmentIndex: number;
      readonly status: "staging";
    })
  | (Staged & {
      readonly finalSegmentIndex: number;
      readonly status: "committing";
    })
  | (Staged & {
      readonly stagedSegments: number;
      readonly status: "appendingTail";
    })
  | (Staged & { readonly status: "done" })
  | (Staged & {
      readonly reason: StagedBaselineAbandonReason;
      /** Whether a stage may still stand, for a best-effort delete. */
      readonly stageStands: boolean;
      readonly status: "abandoned";
    })
  | (Staged & {
      readonly reason: StagedBaselineFailureReason;
      readonly stageStands: boolean;
      readonly status: "failed";
    });

type Tagged<Event> = Event & { readonly attempt: number };

/**
 * What moves an upload. `runStarted` begins a run; every other event is the
 * result of one effect and carries the attempt that started it. The eight
 * refusals are the API's `document_baseline_stage_*` codes, and
 * `coverageRefused` is the rotating route's own coverage refusal.
 */
export type StagedBaselineEvent =
  | { readonly type: "runStarted" }
  | Tagged<{ readonly baselineId: string; readonly type: "planned" }>
  | Tagged<{ readonly type: "stageOpened" }>
  | Tagged<{ readonly nextSegmentIndex: number; readonly type: "stageRead" }>
  | Tagged<{
      readonly headersCurrent: boolean;
      readonly type: "stagedHistoryConfirmed";
    }>
  | Tagged<{ readonly type: "stagedHistoryDiverged" }>
  | Tagged<{ readonly segmentIndex: number; readonly type: "headerResigned" }>
  | Tagged<{ readonly segmentIndex: number; readonly type: "segmentStaged" }>
  | Tagged<{
      readonly segmentIndex: number;
      readonly type: "finalSegmentReady";
    }>
  | Tagged<{ readonly type: "segmentLimitExceeded" }>
  | Tagged<{ readonly type: "commitAccepted" }>
  | Tagged<{ readonly type: "coverageRefused" }>
  | Tagged<{ readonly type: "groupRefused" }>
  | Tagged<{ readonly type: "stageNotFound" }>
  | Tagged<{ readonly type: "stageExpired" }>
  | Tagged<{ readonly type: "stageEpochStale" }>
  | Tagged<{ readonly type: "stageIdConflict" }>
  | Tagged<{ readonly type: "stageLimitReached" }>
  | Tagged<{ readonly type: "stageTooLarge" }>
  | Tagged<{ readonly type: "segmentOutOfOrder" }>
  | Tagged<{ readonly type: "segmentConflict" }>
  | Tagged<{ readonly type: "segmentInvalid" }>
  | Tagged<{ readonly type: "headersStale" }>
  | Tagged<{ readonly type: "released" }>;

export const INITIAL_STAGED_BASELINE_STATE: StagedBaselineState = {
  attempt: 0,
  status: "planning",
};

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

/** Whether the upload is over: nothing moves it but a new run. */
export function isStagedBaselineOver(
  state: StagedBaselineState,
): state is Extract<
  StagedBaselineState,
  { status: "abandoned" | "done" | "failed" }
> {
  return (
    state.status === "abandoned" ||
    state.status === "done" ||
    state.status === "failed"
  );
}

/** How many segments the stage holds, as far as the state knows. */
export function stagedSegmentCount(state: StagedBaselineState): number {
  switch (state.status) {
    case "appendingTail":
    case "confirming":
    case "resigningHeaders":
      return state.stagedSegments;
    case "staging":
      return state.nextSegmentIndex;
    case "committing":
      return state.finalSegmentIndex;
    default:
      return 0;
  }
}

/**
 * A new run. With no stage it plans; an upload that is over plans again;
 * anything else may have a stage standing, wherever its last run stopped,
 * so the run reads it before it relies on it.
 */
function startRun(state: StagedBaselineState): StagedBaselineState {
  const attempt = state.attempt + 1;
  return state.status === "planning" || isStagedBaselineOver(state)
    ? { attempt, status: "planning" }
    : { attempt, baselineId: state.baselineId, status: "resuming" };
}

type StagedState = Exclude<StagedBaselineState, { status: "planning" }>;

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
  state: StagedState,
  nextSegmentIndex: number,
): StagedBaselineState {
  const { attempt, baselineId } = state;
  return { attempt, baselineId, nextSegmentIndex, status: "staging" };
}

/** The staged segments are the history's: re-sign them, or go on staging. */
function afterConfirmation(
  state: Extract<StagedState, { status: "confirming" }>,
  headersCurrent: boolean,
): StagedBaselineState {
  const { attempt, baselineId, stagedSegments } = state;
  return headersCurrent || stagedSegments === 0
    ? staging(state, stagedSegments)
    : {
        attempt,
        baselineId,
        nextHeaderIndex: 0,
        stagedSegments,
        status: "resigningHeaders",
      };
}

function afterHeaderResigned(
  state: Extract<StagedState, { status: "resigningHeaders" }>,
  segmentIndex: number,
): StagedBaselineState {
  if (segmentIndex !== state.nextHeaderIndex) return state;
  const nextHeaderIndex = segmentIndex + 1;
  return nextHeaderIndex < state.stagedSegments
    ? { ...state, nextHeaderIndex }
    : staging(state, state.stagedSegments);
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
      return { attempt, baselineId, stagedSegments, status: "appendingTail" };
    case "headersStale":
      return {
        attempt,
        baselineId,
        nextHeaderIndex: 0,
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
  "segmentStaged",
  "stagedHistoryConfirmed",
  "stageOpened",
  "stageRead",
]);

function isProgressEvent(event: StagedEvent): event is ProgressEvent {
  return PROGRESS_EVENT_TYPES.has(event.type);
}

/** A segment was staged, or the history is spent and the next is final. */
function afterSegment(
  state: Extract<StagedState, { status: "staging" }>,
  event: ProgressEvent,
): StagedBaselineState {
  if (
    (event.type !== "segmentStaged" && event.type !== "finalSegmentReady") ||
    event.segmentIndex !== state.nextSegmentIndex
  ) {
    return state;
  }
  const { attempt, baselineId, nextSegmentIndex } = state;
  return event.type === "segmentStaged"
    ? staging(state, nextSegmentIndex + 1)
    : {
        attempt,
        baselineId,
        finalSegmentIndex: nextSegmentIndex,
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
  const { attempt, baselineId } = state;
  switch (state.status) {
    case "opening":
      return event.type === "stageOpened" ? staging(state, 0) : state;
    case "resuming": {
      if (event.type !== "stageRead") return state;
      const stagedSegments = event.nextSegmentIndex;
      return { attempt, baselineId, stagedSegments, status: "confirming" };
    }
    case "confirming":
      return event.type === "stagedHistoryConfirmed"
        ? afterConfirmation(state, event.headersCurrent)
        : state;
    case "resigningHeaders":
      return event.type === "headerResigned"
        ? afterHeaderResigned(state, event.segmentIndex)
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

/** A refusal or a loss: the upload plans again, reads its stage, or ends. */
function setBack(
  state: StagedState,
  event: Exclude<StagedEvent, ProgressEvent>,
): StagedBaselineState {
  const { attempt, baselineId } = state;
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
    // The stage is not where the writer thought: read it and go on from
    // there.
    case "segmentOutOfOrder":
      return { attempt, baselineId, status: "resuming" };
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
