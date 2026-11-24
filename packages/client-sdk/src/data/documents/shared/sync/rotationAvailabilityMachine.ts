/**
 * Whether this device still starts key rotations of a document (#3194), as
 * pure decisions. A rotation rebuilds the document's whole history in Loro;
 * a death reading a page this device already accepted is far likelier the
 * rebuild's size or state than any update, so it counts toward the rotation.
 * After `MAX_ROTATION_DEATHS` such deaths under one judge, with no completed
 * rebuild between them, the device stops starting rotations of the document
 * and leaves them to other members, which never wait on it. When the last
 * read one update alone, the next rebuild leaves that update out first
 * (`leavingOut`), as it does each further update it dies on alone, and the
 * exact-history check decides between rotating without them (`leftOut`) and
 * stopping. A new judge (decoder or void rules) starts over.
 * `rotationAvailabilityPersistence.ts` stores the state.
 */

/**
 * As many deaths as void an update (`MAX_LORO_RUNTIME_ATTEMPTS`), so the
 * bounded model's one limit (`VoidUpdateProgress`'s MaxAttempts) stands for
 * both; a test holds them equal.
 */
export const MAX_ROTATION_DEATHS = 3;

/**
 * The most updates a device leaves out of one document's rebuilds. Each
 * costs it the deaths that found it, so a writer must spend this many
 * crashing updates on every device before one more stops its rotations.
 */
export const MAX_ROTATION_LEFT_OUT = 8;

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
   * Rebuilds leave `leftOut` out, unread, since one without them equalled
   * the live document, which so never held them; `deaths` counts the
   * rebuilds that died since the last completed, below the limit.
   */
  | (RotationJudgement & {
      readonly status: "leftOut";
      readonly deaths: number;
      readonly leftOut: readonly string[];
    })
  /**
   * The limit's death came reading an update alone, and each later death
   * reading another alone added that one: `trying`, never empty. The device
   * takes them as accepted only on their declared spans, which any writer
   * may set to counters already committed, so the next rebuild leaves them
   * out too, for the exact-history check to decide: one without them that
   * equals the live document shows the device never held them.
   */
  | (RotationJudgement & {
      readonly status: "leavingOut";
      readonly deaths: number;
      readonly leftOut: readonly string[];
      readonly trying: readonly string[];
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

/** The updates a rebuild in this state leaves out, unread. */
export function rotationLeftOut(
  state: RotationAvailability,
): readonly string[] {
  switch (state.status) {
    case "leavingOut":
      return [...state.leftOut, ...state.trying];
    case "leftOut":
      return state.leftOut;
    case "available":
    case "dying":
    case "unavailable":
      return [];
  }
}

/**
 * Whether deaths stand against the rotation, so it reads one update a page
 * and each further death names one update.
 */
export function rotationIsolates(state: RotationAvailability): boolean {
  return (
    state.status === "dying" ||
    state.status === "leavingOut" ||
    (state.status === "leftOut" && state.deaths > 0)
  );
}

/**
 * The update a death at or past the limit adds to those the next rebuild
 * leaves out: the one it read alone, while the bound leaves room; null when
 * the device leaves rotation to other members instead.
 */
function nextToLeaveOut(
  current: RotationAvailability,
  suspects: readonly string[],
): string | null {
  const [alone, ...others] = suspects;
  const leftOut = rotationLeftOut(current);
  return alone !== undefined &&
    others.length === 0 &&
    !leftOut.includes(alone) &&
    leftOut.length < MAX_ROTATION_LEFT_OUT
    ? alone
    : null;
}

/** The state the limit's death leaves: one more update out, or none. */
function atTheLimit(
  judged: RotationJudgement,
  current: RotationAvailability,
  suspects: readonly string[],
): RotationAvailability {
  const next = nextToLeaveOut(current, suspects);
  if (next === null) {
    return { ...judged, deaths: MAX_ROTATION_DEATHS, status: "unavailable" };
  }
  return current.status === "leavingOut"
    ? { ...current, trying: [...current.trying, next] }
    : {
        ...judged,
        deaths: MAX_ROTATION_DEATHS,
        leftOut: rotationLeftOut(current),
        status: "leavingOut",
        trying: [next],
      };
}

function rotationDied(
  current: RotationAvailability,
  event: Extract<RotationAvailabilityEvent, { type: "rotationDied" }>,
): RotationAvailability {
  const judged = { documentId: event.documentId, judge: event.judge };
  switch (current.status) {
    // A rotation started before the limit can still die once it is
    // reached; the device already leaves rotation to others.
    case "unavailable":
      return current;
    // The rebuild trying the updates' absence got past them and died on
    // another alone, which it leaves out too; on several, the deaths were
    // the rebuild's.
    case "leavingOut":
      return atTheLimit(judged, current, event.suspects);
    case "available":
    case "dying":
    case "leftOut": {
      const deaths = (current.status === "available" ? 0 : current.deaths) + 1;
      if (deaths >= MAX_ROTATION_DEATHS) {
        return atTheLimit(judged, current, event.suspects);
      }
      const leftOut = rotationLeftOut(current);
      return leftOut.length > 0
        ? { ...judged, deaths, leftOut, status: "leftOut" }
        : { ...judged, deaths, status: "dying" };
    }
  }
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

/** Whether a rebuild left out every update the state leaves out. */
function leftOutAll(
  current: RotationAvailability,
  event: { readonly leftOut: readonly string[] },
): boolean {
  return rotationLeftOut(current).every((id) => event.leftOut.includes(id));
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
      // held the update. Only a rebuild that left it out decides.
      return current.status === "leavingOut" && leftOutAll(current, event)
        ? {
            deaths: 0,
            documentId: current.documentId,
            judge: current.judge,
            leftOut: rotationLeftOut(current),
            status: "leftOut",
          }
        : current;
    case "rotationDiverged":
      if (!leftOutAll(current, event)) return current;
      // The device holds the update it tried leaving out, so the deaths
      // were the rebuild's. One leaving out updates it once proved it never
      // held now holds one of them: it reads them again from the start.
      if (current.status === "leavingOut") {
        return {
          deaths: current.deaths,
          documentId: current.documentId,
          judge: current.judge,
          status: "unavailable",
        };
      }
      return current.status === "leftOut" ? ROTATION_AVAILABLE : current;
  }
}
