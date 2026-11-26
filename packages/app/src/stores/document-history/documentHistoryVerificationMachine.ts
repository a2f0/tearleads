import type {
  DocumentHistory,
  DocumentHistoryVerification,
  DocumentHistoryVerificationProgress,
  DocumentHistoryVerificationReport,
  DocumentHistoryVerificationUnavailable,
  DocumentHistoryVersion,
} from "@tearleads/client-sdk";

/**
 * Why a check reached no verdict: the SDK's reasons, and `capture_outdated`
 * when the device's history gained edits after the capture on screen was
 * taken, so the verdict describes a history that is not the one shown.
 */
export type DocumentHistoryVerificationUnavailableReason =
  | DocumentHistoryVerificationUnavailable["reason"]
  | "capture_outdated";

type PlainUnavailableReason = Exclude<
  DocumentHistoryVerificationUnavailableReason,
  "epoch_key_unreachable"
>;

/**
 * Checking the capture on screen against the signed uploads the server
 * holds, tagged with the request that started it.
 *
 * - `idle`: nothing asked. The history shown is this device's copy, unchecked.
 * - `checking`: a check is running against the capture whose newest version
 *   is `captureVersion`. `progress` is null until the first page is read.
 * - `verified`: wherever this device and the server both hold an operation,
 *   it is the same one. `report` says who uploaded what.
 * - `mismatch`: some operation differs. `signed` replays the history built
 *   from the signed uploads; whoever leaves this state closes it.
 * - `unavailable`: no verdict, for `reason`.
 * - `failed`: the check threw something that is none of the above.
 */
export type DocumentHistoryVerificationState =
  | { readonly status: "idle" }
  | {
      readonly captureVersion: DocumentHistoryVersion;
      readonly progress: DocumentHistoryVerificationProgress | null;
      readonly run: number;
      readonly status: "checking";
    }
  | {
      readonly report: DocumentHistoryVerificationReport;
      readonly run: number;
      readonly status: "verified";
    }
  | {
      readonly report: DocumentHistoryVerificationReport;
      readonly run: number;
      readonly signed: DocumentHistory;
      readonly status: "mismatch";
    }
  | {
      readonly reason: PlainUnavailableReason;
      readonly run: number;
      readonly status: "unavailable";
    }
  | {
      /** The content-key epoch whose key this device cannot reach. */
      readonly contentKeyEpoch: number;
      readonly reason: "epoch_key_unreachable";
      readonly run: number;
      readonly status: "unavailable";
    }
  | {
      readonly message: string;
      readonly run: number;
      readonly status: "failed";
    };

export type DocumentHistoryVerificationEvent =
  | {
      /** The newest version of the capture the check is asked about. */
      readonly captureVersion: DocumentHistoryVersion;
      readonly run: number;
      readonly type: "requested";
    }
  | {
      readonly progress: DocumentHistoryVerificationProgress;
      readonly run: number;
      readonly type: "progressed";
    }
  | {
      /** Null when the database was not ready to read. */
      readonly result: DocumentHistoryVerification | null;
      readonly run: number;
      readonly type: "settled";
    }
  | {
      readonly message: string;
      readonly run: number;
      readonly type: "failed";
    }
  /** The capture was closed or replaced, or its reader went away. */
  | { readonly type: "capture-changed" };

/** Work the caller does on entering the state a transition returned. */
export type DocumentHistoryVerificationEffect =
  /** Stop the check `run` started; nobody is waiting for it. */
  | { readonly run: number; readonly type: "abort" }
  /** Close a signed replay no state holds any more. */
  | { readonly signed: DocumentHistory; readonly type: "close-signed" };

export interface DocumentHistoryVerificationStep {
  readonly effects: ReadonlyArray<DocumentHistoryVerificationEffect>;
  readonly state: DocumentHistoryVerificationState;
}

export const IDLE_DOCUMENT_HISTORY_VERIFICATION: DocumentHistoryVerificationState =
  { status: "idle" };

/**
 * The ranges a check verified, for the history on screen: each credits a run
 * of operations to the signed upload that first carried it. Null when no
 * check of the capture has reached a verdict, and on a mismatch while this
 * device's copy is shown: a range is matched by peer and counter, and a
 * mismatch says some operation both histories hold differs, so the device's
 * copy of it is not the one the upload carried.
 */
export function verifiedDocumentHistoryRanges(
  state: DocumentHistoryVerificationState,
  shown: "local" | "signed",
): DocumentHistoryVerificationReport["ranges"] | null {
  if (state.status === "verified") return state.report.ranges;
  return state.status === "mismatch" && shown === "signed"
    ? state.report.ranges
    : null;
}

type CheckingState = Extract<
  DocumentHistoryVerificationState,
  { status: "checking" }
>;

const NO_EFFECTS: ReadonlyArray<DocumentHistoryVerificationEffect> = [];

function stay(
  state: DocumentHistoryVerificationState,
): DocumentHistoryVerificationStep {
  return { effects: NO_EFFECTS, state };
}

/** What must be stopped or closed when `state` is left for good. */
function leave(
  state: DocumentHistoryVerificationState,
): ReadonlyArray<DocumentHistoryVerificationEffect> {
  if (state.status === "checking") {
    return [{ run: state.run, type: "abort" }];
  }
  if (state.status === "mismatch") {
    return [{ signed: state.signed, type: "close-signed" }];
  }
  return NO_EFFECTS;
}

/** A version's entries come in no set order: compare them as a set. */
function isSameVersion(
  left: DocumentHistoryVersion,
  right: DocumentHistoryVersion,
): boolean {
  if (left.length !== right.length) return false;
  const counters = new Map(
    left.map(({ counter, peerId }) => [peerId, counter]),
  );
  return right.every(({ counter, peerId }) => counters.get(peerId) === counter);
}

function unavailable(
  run: number,
  result: DocumentHistoryVerificationUnavailable,
): DocumentHistoryVerificationState {
  return result.reason === "epoch_key_unreachable"
    ? {
        contentKeyEpoch: result.contentKeyEpoch,
        reason: result.reason,
        run,
        status: "unavailable",
      }
    : { reason: result.reason, run, status: "unavailable" };
}

/** The running check's result, as the state it leads to. */
function settle(
  state: CheckingState,
  result: DocumentHistoryVerification | null,
): DocumentHistoryVerificationStep {
  const { run } = state;
  if (result === null) {
    return stay({ reason: "interrupted", run, status: "unavailable" });
  }
  if (result.status === "unavailable") return stay(unavailable(run, result));
  const { localVersion, ranges, serverAhead, voidUpdateCount } = result;
  if (!isSameVersion(localVersion, state.captureVersion)) {
    return {
      effects: dropped(result),
      state: { reason: "capture_outdated", run, status: "unavailable" },
    };
  }
  const report = { localVersion, ranges, serverAhead, voidUpdateCount };
  return stay(
    result.status === "mismatch"
      ? { report, run, signed: result.signed, status: "mismatch" }
      : { report, run, status: "verified" },
  );
}

/** A result no state will hold: its signed replay, if any, is closed. */
function dropped(
  result: DocumentHistoryVerification | null,
): ReadonlyArray<DocumentHistoryVerificationEffect> {
  return result?.status === "mismatch"
    ? [{ signed: result.signed, type: "close-signed" }]
    : NO_EFFECTS;
}

function isRunning(
  state: DocumentHistoryVerificationState,
  run: number,
): state is CheckingState {
  return state.status === "checking" && state.run === run;
}

/**
 * Pure transition. It returns the state to enter and the effects the caller
 * runs on entering it; an ignored event returns the same state reference.
 * Only the running check may report progress, settle, or fail. A signed
 * replay is closed by an effect exactly once: when its `mismatch` state is
 * left, or at once when the result that brought it is not taken.
 *
 * | state \ event | requested                | progressed (run) | settled (run)                     | failed (run) | capture-changed       |
 * | ------------- | ------------------------ | ---------------- | --------------------------------- | ------------ | --------------------- |
 * | idle          | checking                 | (same)           | (same)                            | (same)       | (same)                |
 * | checking      | checking, abort the old  | progress         | verified, mismatch or unavailable | failed       | idle, abort           |
 * | verified      | checking                 | (same)           | (same)                            | (same)       | idle                  |
 * | mismatch      | checking, close `signed` | (same)           | (same)                            | (same)       | idle, close `signed`  |
 * | unavailable   | checking                 | (same)           | (same)                            | (same)       | idle                  |
 * | failed        | checking                 | (same)           | (same)                            | (same)       | idle                  |
 *
 * A `settled` that is not the running check's changes nothing, and closes the
 * signed replay it brought. A result for a history newer than the capture is
 * `unavailable` (`capture_outdated`), its signed replay closed.
 */
export function transitionDocumentHistoryVerification(
  state: DocumentHistoryVerificationState,
  event: DocumentHistoryVerificationEvent,
): DocumentHistoryVerificationStep {
  switch (event.type) {
    case "requested":
      return {
        effects: leave(state),
        state: {
          captureVersion: event.captureVersion,
          progress: null,
          run: event.run,
          status: "checking",
        },
      };
    case "progressed":
      return isRunning(state, event.run)
        ? stay({ ...state, progress: event.progress })
        : stay(state);
    case "settled":
      return isRunning(state, event.run)
        ? settle(state, event.result)
        : { effects: dropped(event.result), state };
    case "failed":
      return isRunning(state, event.run)
        ? stay({ message: event.message, run: state.run, status: "failed" })
        : stay(state);
    case "capture-changed":
      return state.status === "idle"
        ? stay(state)
        : { effects: leave(state), state: IDLE_DOCUMENT_HISTORY_VERIFICATION };
    default:
      return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled event: ${JSON.stringify(value)}`);
}
