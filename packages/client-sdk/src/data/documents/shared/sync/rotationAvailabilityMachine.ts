/**
 * Whether this device still starts key rotations of a document (#3194), as
 * pure decisions. A rotation rebuilds the document's whole history in Loro,
 * which this device already accepted, so a death there is far likelier the
 * rebuild's size or state than any update: it counts toward the rotation.
 * After `MAX_ROTATION_DEATHS` such deaths under one judge, with no completed
 * rebuild between them, the device stops starting rotations of the document
 * and leaves them to other members, which never wait on it. A new judge
 * (decoder or void rules) starts over. `rotationAvailabilityPersistence.ts`
 * stores the state.
 */

export const MAX_ROTATION_DEATHS = 3;

/** The document and judge a state is about. */
export interface RotationJudgement {
  readonly documentId: string;
  readonly judge: string;
}

export type RotationAvailability =
  | { readonly status: "available" }
  /** Rebuilds died, fewer times than the limit, since the last completed. */
  | (RotationJudgement & {
      readonly status: "dying";
      readonly deaths: number;
    })
  /** This device starts no rotation of the document under this judge. */
  | (RotationJudgement & {
      readonly status: "unavailable";
      readonly deaths: number;
    });

export type RotationAvailabilityEvent =
  /** A lifetime died rebuilding the document's history, alone in its window. */
  | (RotationJudgement & { readonly type: "rotationDied" })
  /** A rotation read and rebuilt the document's whole history. */
  | (RotationJudgement & { readonly type: "rotationRebuilt" });

export const ROTATION_AVAILABLE: RotationAvailability = {
  status: "available",
};

/**
 * The state as it stands for this document under this judge: deaths under
 * another judge or for another server document stand for nothing.
 */
export function currentRotationAvailability(
  state: RotationAvailability,
  current: RotationJudgement,
): RotationAvailability {
  return state.status !== "available" &&
    state.documentId === current.documentId &&
    state.judge === current.judge
    ? state
    : ROTATION_AVAILABLE;
}

export function transitionRotationAvailability(
  state: RotationAvailability,
  event: RotationAvailabilityEvent,
): RotationAvailability {
  const current = currentRotationAvailability(state, event);
  switch (event.type) {
    case "rotationDied": {
      const deaths = (current.status === "available" ? 0 : current.deaths) + 1;
      const judged = { documentId: event.documentId, judge: event.judge };
      return deaths >= MAX_ROTATION_DEATHS
        ? { ...judged, deaths, status: "unavailable" }
        : { ...judged, deaths, status: "dying" };
    }
    case "rotationRebuilt":
      // An unavailable device starts no rotation; one already running when
      // the limit was reached does not undo it.
      return current.status === "unavailable" ? current : ROTATION_AVAILABLE;
  }
}
