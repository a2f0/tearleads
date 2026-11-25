import type { DocumentListingRevalidation } from "../../../../workflows/documents";

/**
 * What a store knows of the read a listing owes its document; `null` when it
 * knows of none. See `listingCoverage.ts` for who reads and settles the debt.
 */
export type OwedListingReadState =
  /** The debt as the store last read it. */
  | { readonly read: DocumentListingRevalidation; readonly status: "owed" }
  /** A pull left `read` unpaid, and its one later pull was requested. */
  | { readonly read: DocumentListingRevalidation; readonly status: "retried" };

export type OwedListingReadEvent =
  /** The store read the durable debt: at load, or before a pull. */
  | {
      readonly read: DocumentListingRevalidation | null;
      readonly type: "observed";
    }
  /** A completed pull paid `read`. */
  | { readonly read: DocumentListingRevalidation; readonly type: "paid" }
  /** A completed pull did not cover `read`. */
  | { readonly read: DocumentListingRevalidation; readonly type: "unpaid" };

/**
 * A debt renewed by a later listing carries a new revision, which is owed
 * and retried afresh; an event about an older revision leaves it alone.
 */
export function transitionOwedListingRead(
  state: OwedListingReadState | null,
  event: OwedListingReadEvent,
): OwedListingReadState | null {
  const sameDebt = state?.read.revision === event.read?.revision;
  switch (event.type) {
    case "observed":
      if (event.read === null) return null;
      return sameDebt ? state : { read: event.read, status: "owed" };
    case "paid":
      return sameDebt ? null : state;
    case "unpaid":
      if (state !== null && (!sameDebt || state.status === "retried")) {
        return state;
      }
      return { read: event.read, status: "retried" };
  }
}
