/**
 * What the writer keeps of a segment it staged: enough to prove later that
 * a re-proven history still gives the same bytes, to sign its header again,
 * and to carry the digest forward. Never the ciphertext.
 */
export interface StagedSegmentRecord {
  readonly ciphertextHash: string;
  readonly contentRecordId: string;
  readonly dependencyVersionVector: string;
  /** The stage's digest once this segment is staged. */
  readonly digestAfter: string;
  readonly metadataHash: string;
  readonly partialEndVersionVector: string;
  readonly partialStartVersionVector: string;
  readonly plaintextHash: string;
  readonly updateId: string;
}

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
  | "segment_invalid"
  /** The stage was never where its own answers put it, read after read. */
  | "stage_unsettled";

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
 * A stage that may hold segments, and what the writer remembers of them.
 * Both fields are the machine's: only the current attempt's events change
 * them, so an answer a superseded run was waiting for cannot.
 */
export interface Filling extends Staged {
  /**
   * What the staged headers were signed for (`RotationBaselineSigner`), or
   * null when they are not known to be signed for one thing: the API said
   * they are stale, or they are part way through being signed again.
   */
  readonly headersSignedFor: string | null;
  /** The staged segments, in index order; the last may be unacknowledged. */
  readonly records: readonly StagedSegmentRecord[];
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
  | (Filling & {
      /** How often this run has read the stage. */
      readonly reads: number;
      readonly status: "resuming";
    })
  | (Filling & {
      readonly reads: number;
      readonly stagedSegments: number;
      readonly status: "confirming";
    })
  | (Filling & {
      readonly nextHeaderIndex: number;
      readonly reads: number;
      readonly stagedSegments: number;
      readonly status: "resigningHeaders";
    })
  | (Filling & {
      readonly nextSegmentIndex: number;
      readonly reads: number;
      readonly status: "staging";
    })
  | (Filling & {
      readonly finalSegmentIndex: number;
      readonly status: "committing";
    })
  | (Filling & {
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
 * result of one effect and carries the attempt that started it. The ten
 * refusals are the API's `document_baseline_stage_*` codes, and
 * `coverageRefused` is the rotating route's own coverage refusal.
 */
export type StagedBaselineEvent =
  | { readonly type: "runStarted" }
  | Tagged<{ readonly baselineId: string; readonly type: "planned" }>
  | Tagged<{
      /** What the run signs its headers for. */
      readonly signedFor: string;
      readonly type: "stageOpened";
    }>
  | Tagged<{ readonly nextSegmentIndex: number; readonly type: "stageRead" }>
  | Tagged<{
      /** What the run would sign a header for now. */
      readonly signedFor: string;
      readonly type: "stagedHistoryConfirmed";
    }>
  | Tagged<{ readonly type: "stagedHistoryDiverged" }>
  | Tagged<{
      readonly segmentIndex: number;
      readonly signedFor: string;
      readonly type: "headerResigned";
    }>
  | Tagged<{
      /** Kept before the request goes out: its answer may be lost. */
      readonly record: StagedSegmentRecord;
      readonly segmentIndex: number;
      readonly type: "segmentSent";
    }>
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

/**
 * How often one run reads its stage before it gives the upload up. A run
 * reads once when it resumes, and again when the API says a segment is not
 * the stage's next; a stage that is never where its own answers put it
 * would otherwise keep the run reading, confirming and sending for ever.
 */
export const MAX_STAGE_READS_PER_RUN = 3;

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

/** What the writer remembers of the stage's segments, if it may hold any. */
export function stagedRecords(
  state: StagedBaselineState,
): readonly StagedSegmentRecord[] {
  return "records" in state ? state.records : [];
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
