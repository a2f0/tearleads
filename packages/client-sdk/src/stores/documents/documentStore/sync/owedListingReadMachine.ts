import type { DocumentListingRevalidation } from "../../../../workflows/documents";

/**
 * What a store knows of the read its document is owed beyond its own probes;
 * `null` when it knows of none. See `listingCoverage.ts` for who reads and
 * settles a listing's debt.
 *
 * | state     | event          | condition                  | next      |
 * | --------- | -------------- | -------------------------- | --------- |
 * | any       | observed       | a debt of another revision | owed      |
 * | owed, retried | observed   | the same debt              | unchanged |
 * | owed, retried | observed   | no debt                    | none      |
 * | withheld  | observed       | no debt                    | withheld  |
 * | owed, retried | paid       | the same debt              | none      |
 * | none, owed, withheld | unpaid | the same debt, or none known | retried |
 * | none      | cursorWithheld |                            | withheld  |
 * | withheld  | pullCompleted  |                            | none      |
 *
 * Every other pair leaves the state unchanged.
 */
export type OwedListingReadState =
  /** The debt as the store last read it. */
  | { readonly read: DocumentListingRevalidation; readonly status: "owed" }
  /** A pull left `read` unpaid, and its one later pull was requested. */
  | { readonly read: DocumentListingRevalidation; readonly status: "retried" }
  /**
   * No listing owes a read, but the record's processed cursor is one its
   * next pull withholds, so that pull judges its updates again. No listing
   * will ask for it: the document's row is behind its lane's watermark.
   */
  | { readonly status: "withheld" };

export type OwedListingReadEvent =
  /** The store read the durable debt: at load, or before a pull. */
  | {
      readonly read: DocumentListingRevalidation | null;
      readonly type: "observed";
    }
  /** A completed pull paid `read`. */
  | { readonly read: DocumentListingRevalidation; readonly type: "paid" }
  /** A completed pull did not cover `read`. */
  | { readonly read: DocumentListingRevalidation; readonly type: "unpaid" }
  /** The loaded record holds a cursor its next pull withholds. */
  | { readonly type: "cursorWithheld" }
  /** A pull reached its bound, so it saved the cursor it judged up to. */
  | { readonly type: "pullCompleted" };

/**
 * A debt renewed by a later listing carries a new revision, which is owed
 * and retried afresh; an event about an older revision leaves it alone. A
 * debt takes the place of a withheld cursor: the pull that pays it is the
 * pull that judges again.
 */
export function transitionOwedListingRead(
  state: OwedListingReadState | null,
  event: OwedListingReadEvent,
): OwedListingReadState | null {
  switch (event.type) {
    case "cursorWithheld":
      return state ?? { status: "withheld" };
    case "pullCompleted":
      return state?.status === "withheld" ? null : state;
    default:
      return transitionForDebt(state, event);
  }
}

type DebtEvent = Exclude<
  OwedListingReadEvent,
  { readonly type: "cursorWithheld" | "pullCompleted" }
>;

type KnownDebt = Exclude<OwedListingReadState, { readonly status: "withheld" }>;

function knownDebt(state: OwedListingReadState | null): KnownDebt | null {
  return state === null || state.status === "withheld" ? null : state;
}

/** The store read the durable debt, or read that there is none. */
function afterObserved(
  state: OwedListingReadState | null,
  read: DocumentListingRevalidation | null,
): OwedListingReadState | null {
  const known = knownDebt(state);
  // Reading no debt clears a known one, and leaves a withheld cursor.
  if (read === null) return known === null ? state : null;
  return known?.read.revision === read.revision
    ? state
    : { read, status: "owed" };
}

/** A completed pull did not cover `read`: one later pull per revision. */
function afterUnpaid(
  state: OwedListingReadState | null,
  read: DocumentListingRevalidation,
): OwedListingReadState | null {
  const known = knownDebt(state);
  const anotherDebt = known !== null && known.read.revision !== read.revision;
  if (anotherDebt || known?.status === "retried") return state;
  return { read, status: "retried" };
}

/** The events that carry what a store read of, or did about, a debt. */
function transitionForDebt(
  state: OwedListingReadState | null,
  event: DebtEvent,
): OwedListingReadState | null {
  switch (event.type) {
    case "observed":
      return afterObserved(state, event.read);
    case "paid":
      return knownDebt(state)?.read.revision === event.read.revision
        ? null
        : state;
    case "unpaid":
      return afterUnpaid(state, event.read);
  }
}
