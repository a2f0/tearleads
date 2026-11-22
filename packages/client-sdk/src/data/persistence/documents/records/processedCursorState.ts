/** Where one recorded sync page sits in its pull. */
export interface PullPagePosition {
  /** The request consumed no continuation: this page starts a pull. */
  readonly first: boolean;
  /** The pull completed with this page. */
  readonly last: boolean;
  /** The processed cursor this page's request carried, if any. */
  readonly sentCursor: string | null;
  /** The pull's upper bound, as the server named it. */
  readonly throughUpdateId: string | null;
}

/**
 * What the pull in progress started from: the judge its first page was
 * judged with and the cursor that page sent. A pull whose later pages ran
 * under anything else (a decoder upgrade, a cursor cleared or withheld
 * meanwhile) did not judge everything its completion would claim.
 */
export interface PullPremise {
  readonly judge: string;
  readonly sentCursor: string | null;
}

/**
 * What recording one sync page does to its scope's processed cursor.
 *
 * - `unchanged`: a later page of a pull whose premise holds; nothing moves.
 * - `cleared`: a void was judged under another content key for its epoch than
 *   the pass held. The cursor and the pull's premise are dropped, so the next
 *   pull goes by version alone and judges that update again.
 * - `pulling`: the first page of a pull that continues; its premise is kept
 *   for the pages after it.
 * - `abandoned`: a page ran under another premise than its pull's first page.
 *   The pull will not advance the cursor, and the earlier cursor stands.
 * - `advanced`: the pull completed under one premise. `dropsOtherJudges`
 *   marks a pull sent without a cursor: it judged every update its frontier
 *   left uncovered, so a void row another judge wrote names an update the
 *   frontier now covers. `through` is null when the server named no update.
 */
export type ProcessedCursorTransition =
  | { readonly status: "unchanged" }
  | { readonly status: "cleared" }
  | { readonly premise: PullPremise; readonly status: "pulling" }
  | { readonly status: "abandoned" }
  | {
      readonly dropsOtherJudges: boolean;
      readonly status: "advanced";
      readonly through: {
        readonly updateId: string;
        readonly version: string;
      } | null;
    };

export function processedCursorTransition(input: {
  /** The judge this page was judged with. */
  readonly judge: string;
  /** Whether a recorded void was judged under another key for its epoch. */
  readonly keyConflict: boolean;
  /** Undefined for a scope that keeps no cursor. */
  readonly page: PullPagePosition | undefined;
  /** The frontier the record holds once the page is saved. */
  readonly recordedFrontier: string;
  /** The premise the scope's first page of this pull recorded, if any. */
  readonly storedPremise: PullPremise | null;
}): ProcessedCursorTransition {
  if (input.keyConflict) return { status: "cleared" };
  const { page } = input;
  if (!page) return { status: "unchanged" };
  const premise: PullPremise | null = page.first
    ? { judge: input.judge, sentCursor: page.sentCursor }
    : input.storedPremise;
  if (
    premise === null ||
    premise.judge !== input.judge ||
    premise.sentCursor !== page.sentCursor
  ) {
    return { status: "abandoned" };
  }
  if (!page.last) {
    return page.first
      ? { premise, status: "pulling" }
      : { status: "unchanged" };
  }
  return {
    dropsOtherJudges: page.sentCursor === null,
    status: "advanced",
    through:
      page.throughUpdateId === null
        ? null
        : { updateId: page.throughUpdateId, version: input.recordedFrontier },
  };
}
