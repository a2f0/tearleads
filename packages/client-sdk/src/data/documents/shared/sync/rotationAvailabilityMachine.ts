/**
 * Whether this device still starts key rotations of a document (#3194), as
 * pure decisions. A rotation rebuilds the document's whole history in Loro;
 * a death reading a page this device already accepted is far likelier the
 * rebuild's size or state than any update, so it counts toward the rotation.
 * After `MAX_ROTATION_DEATHS` such deaths under one judge, with no completed
 * rebuild between them, the device stops starting rotations of the document
 * and leaves them to other members, which never wait on it. When the last
 * read one update alone, the next rebuild leaves that update out first
 * (`leavingOut`), and the exact-history check decides between rotating
 * without it (`leftOut`) and stopping. A new judge (decoder or void rules)
 * starts over. `rotationAvailabilityPersistence.ts` stores the state.
 */

/**
 * As many deaths as void an update (`MAX_LORO_RUNTIME_ATTEMPTS`), so the
 * bounded model's one limit (`VoidUpdateProgress`'s MaxAttempts) stands for
 * both; a test holds them equal.
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
  /**
   * The limit's death came reading one update alone. The device takes it as
   * accepted only on its declared span, which any writer may set to
   * counters already committed, so the next rebuild leaves the update out,
   * unread, for the exact-history check to decide: one without it that
   * equals the live document shows the device never held it.
   */
  | (RotationJudgement & {
      readonly status: "leavingOut";
      readonly deaths: number;
      readonly leftOut: string;
    })
  /**
   * A rebuild leaving `leftOut` out equalled the live document, so rebuilds
   * keep leaving it out; `deaths` counts those since the last completed.
   */
  | (RotationJudgement & {
      readonly status: "leftOut";
      readonly deaths: number;
      readonly leftOut: string;
    })
  /** This device starts no rotation of the document under this judge. */
  | (RotationJudgement & {
      readonly status: "unavailable";
      readonly deaths: number;
    });

export type RotationAvailabilityEvent =
  /**
   * A lifetime died rebuilding the document's history, alone in its window,
   * reading `suspects`.
   */
  | (RotationJudgement & {
      readonly type: "rotationDied";
      readonly suspects: readonly string[];
    })
  /** A rotation read and rebuilt the document's whole history. */
  | (RotationJudgement & { readonly type: "rotationRebuilt" })
  /**
   * A rebuild leaving `leftOut` out, unread, equalled the live document's
   * history, and was installed.
   */
  | (RotationJudgement & {
      readonly type: "rotationProven";
      readonly leftOut: readonly string[];
    })
  /** A rebuild leaving `leftOut` out differed from the live document's. */
  | (RotationJudgement & {
      readonly type: "rotationDiverged";
      readonly leftOut: readonly string[];
    });

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

function rotationDied(
  current: RotationAvailability,
  event: Extract<RotationAvailabilityEvent, { type: "rotationDied" }>,
): RotationAvailability {
  const judged = { documentId: event.documentId, judge: event.judge };
  if (current.status === "unavailable") {
    // A rotation started before the limit can still die once it is
    // reached; the device already leaves rotation to others.
    return current;
  }
  const deaths = (current.status === "available" ? 0 : current.deaths) + 1;
  // A death with the update left out, whether the rebuild that tries it
  // or a later one, belongs to the rebuild: only one update is left out.
  if (current.status === "leavingOut" || current.status === "leftOut") {
    return current.status === "leftOut" && deaths < MAX_ROTATION_DEATHS
      ? { ...current, deaths }
      : { ...judged, deaths, status: "unavailable" };
  }
  if (deaths < MAX_ROTATION_DEATHS) {
    return { ...judged, deaths, status: "dying" };
  }
  const [alone, ...others] = event.suspects;
  return alone !== undefined && others.length === 0
    ? { ...judged, deaths, leftOut: alone, status: "leavingOut" }
    : { ...judged, deaths, status: "unavailable" };
}

function rotationRebuilt(current: RotationAvailability): RotationAvailability {
  switch (current.status) {
    // Deaths below the limit were not the rebuild's to keep.
    case "dying":
      return ROTATION_AVAILABLE;
    case "leftOut":
      return current.deaths === 0 ? current : { ...current, deaths: 0 };
    // Only the exact-history check decides a rebuild leaving an update out.
    // An unavailable device starts no rotation: one already running when
    // the limit was reached does not undo it.
    case "available":
    case "leavingOut":
    case "unavailable":
      return current;
  }
}

/**
 * Whether the rebuild an event reports tried leaving out the update a
 * `leavingOut` state names: only that one decides it.
 */
function decides(
  current: RotationAvailability,
  event: { readonly leftOut: readonly string[] },
): current is Extract<RotationAvailability, { status: "leavingOut" }> {
  return (
    current.status === "leavingOut" && event.leftOut.includes(current.leftOut)
  );
}

export function transitionRotationAvailability(
  state: RotationAvailability,
  event: RotationAvailabilityEvent,
): RotationAvailability {
  const current = currentRotationAvailability(state, event);
  switch (event.type) {
    case "rotationDied":
      return rotationDied(current, event);
    case "rotationRebuilt":
      return rotationRebuilt(current);
    case "rotationProven":
      // Left out, the rebuild equalled the live document, which so never
      // held the update.
      return decides(current, event)
        ? { ...current, deaths: 0, status: "leftOut" }
        : current;
    case "rotationDiverged":
      // Only the rebuild trying the update's absence decides by diverging:
      // the device holds the update, so the deaths were the rebuild's. Any
      // other rebuild's divergence fails that rotation alone.
      return decides(current, event)
        ? {
            deaths: current.deaths,
            documentId: current.documentId,
            judge: current.judge,
            status: "unavailable",
          }
        : current;
  }
}
