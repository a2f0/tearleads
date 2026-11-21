/**
 * One slot's held-copy check: whether the local file a held attachment row
 * names still holds the bytes the row records. A restored backup can keep the
 * row while the file is missing or damaged, and the row alone would keep
 * hydration from fetching the copy again.
 */

/**
 * The copy a check reads: the row's storage key and plaintext digest, in the
 * blob store that holds the file. A finding about one blob store says nothing
 * about the same key in another.
 */
export interface HeldCopy {
  readonly blobStore: object;
  readonly contentSha256: string;
  readonly storageKey: string;
}

export type HeldCopyUnavailableReason = "missing" | "damaged";

export type HeldCopyCheck =
  | {
      readonly status: "checking";
      readonly attempt: number;
      readonly copy: HeldCopy;
    }
  | { readonly status: "verified"; readonly copy: HeldCopy }
  | {
      readonly status: "unavailable";
      readonly copy: HeldCopy;
      readonly reason: HeldCopyUnavailableReason;
    };

export type HeldCopyCheckEvent =
  /** First access to a copy this store session has not checked. */
  | {
      readonly type: "checkStarted";
      readonly attempt: number;
      readonly copy: HeldCopy;
    }
  | {
      readonly type: "checkFinished";
      readonly attempt: number;
      readonly result: "present" | HeldCopyUnavailableReason;
    }
  /** The read failed or its store was reset: not evidence either way. */
  | { readonly type: "checkAbandoned"; readonly attempt: number }
  /** This store wrote the copy's bytes itself, e.g. a verified download. */
  | { readonly type: "copyWritten"; readonly copy: HeldCopy };

export function sameHeldCopy(left: HeldCopy, right: HeldCopy): boolean {
  return (
    left.blobStore === right.blobStore &&
    left.storageKey === right.storageKey &&
    left.contentSha256 === right.contentSha256
  );
}

/** Pure; `undefined` is a slot whose copy has not been checked. */
export function transitionHeldCopyCheck(
  current: HeldCopyCheck | undefined,
  event: HeldCopyCheckEvent,
): HeldCopyCheck | undefined {
  switch (event.type) {
    case "checkStarted":
      // A copy is checked once per session; a different copy starts over.
      return current && sameHeldCopy(current.copy, event.copy)
        ? current
        : { status: "checking", attempt: event.attempt, copy: event.copy };
    case "checkFinished":
      // Only the current attempt may settle: a copy written meanwhile wins.
      if (current?.status !== "checking" || current.attempt !== event.attempt)
        return current;
      return event.result === "present"
        ? { status: "verified", copy: current.copy }
        : { status: "unavailable", copy: current.copy, reason: event.result };
    case "checkAbandoned":
      // The copy is unchecked again, so its next first access reads it.
      return current?.status === "checking" && current.attempt === event.attempt
        ? undefined
        : current;
    case "copyWritten":
      return { status: "verified", copy: event.copy };
    default:
      return event satisfies never;
  }
}
