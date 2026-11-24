import type { Quad } from "qr/decode.js";

/** Pixel size of the frame the decoder read; overlay coordinates use it. */
export interface RecoveryQrFrameSize {
  readonly width: number;
  readonly height: number;
}

/** One decoder pass over a camera frame that did not finish the scan. */
export interface RecoveryQrFrame extends RecoveryQrFrameSize {
  readonly at: number;
  /** Edges of a QR symbol whose finder patterns were located, if any. */
  readonly outline: Quad | undefined;
  /** A symbol was read, but its value is not a recovery key. */
  readonly rejected: boolean;
}

export type RecoveryKeyScanState =
  | { readonly status: "starting" }
  | { readonly status: "searching"; readonly frame: RecoveryQrFrameSize }
  | {
      readonly status: "located";
      readonly frame: RecoveryQrFrameSize;
      readonly outline: Quad;
      readonly seenAt: number;
    }
  | {
      readonly status: "rejected";
      readonly frame: RecoveryQrFrameSize;
      readonly outline: Quad | undefined;
      readonly seenAt: number;
      readonly rejectedAt: number;
    }
  | { readonly status: "failed"; readonly message: string };

export type RecoveryKeyScanEvent =
  | { readonly type: "frame"; readonly frame: RecoveryQrFrame }
  | { readonly type: "fail"; readonly message: string };

export const INITIAL_RECOVERY_KEY_SCAN_STATE: RecoveryKeyScanState = {
  status: "starting",
};

/** A located code keeps its outline across a few frames that miss it. */
export const LOCATED_HOLD_MS = 500;
/** A rejection stays readable while the wrong code moves around or away. */
export const REJECTED_HOLD_MS = 2000;

function sameSize(a: RecoveryQrFrameSize, b: RecoveryQrFrameSize): boolean {
  return a.width === b.width && a.height === b.height;
}

function frameSize({ width, height }: RecoveryQrFrame): RecoveryQrFrameSize {
  return { width, height };
}

/** While a rejection is shown, the outline follows the code or fades out. */
function holdRejection(
  state: Extract<RecoveryKeyScanState, { status: "rejected" }>,
  frame: RecoveryQrFrame,
): RecoveryKeyScanState {
  if (frame.outline) {
    return {
      ...state,
      frame: frameSize(frame),
      outline: frame.outline,
      seenAt: frame.at,
    };
  }
  if (state.outline && frame.at - state.seenAt >= LOCATED_HOLD_MS) {
    return { ...state, outline: undefined };
  }
  return state;
}

function onFrame(
  state: Exclude<RecoveryKeyScanState, { status: "failed" }>,
  frame: RecoveryQrFrame,
): RecoveryKeyScanState {
  const size = frameSize(frame);
  if (frame.rejected) {
    return {
      status: "rejected",
      frame: size,
      outline: frame.outline,
      seenAt: frame.at,
      rejectedAt: frame.at,
    };
  }
  if (
    state.status === "rejected" &&
    frame.at - state.rejectedAt < REJECTED_HOLD_MS
  ) {
    return holdRejection(state, frame);
  }
  if (frame.outline) {
    return {
      status: "located",
      frame: size,
      outline: frame.outline,
      seenAt: frame.at,
    };
  }
  if (state.status === "located" && frame.at - state.seenAt < LOCATED_HOLD_MS) {
    return state;
  }
  if (state.status === "searching" && sameSize(state.frame, size)) {
    return state;
  }
  return { status: "searching", frame: size };
}

/**
 * The live recovery QR scan. A camera failure is terminal: the first message
 * wins and later frames cannot hide it. An accepted code ends the scan outside
 * this machine, by stopping the camera and closing the scanner.
 */
export function transitionRecoveryKeyScan(
  state: RecoveryKeyScanState,
  event: RecoveryKeyScanEvent,
): RecoveryKeyScanState {
  if (state.status === "failed") return state;
  switch (event.type) {
    case "frame":
      return onFrame(state, event.frame);
    case "fail":
      return { status: "failed", message: event.message };
    default:
      return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled recovery scan event: ${JSON.stringify(value)}`);
}
