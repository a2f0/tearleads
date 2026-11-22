/**
 * What recording one sync page does to its scope's processed cursor.
 *
 * - `unchanged`: the page did not end its pull, so the cursor stays put.
 * - `cleared`: a void was judged under another content key for its epoch than
 *   the pass held, so the next pull goes by version alone and judges it again.
 * - `advanced`: the pull completed. `dropsOtherJudges` marks a pull sent
 *   without a cursor: it judged every update its frontier left uncovered, so a
 *   void row another judge wrote names an update the frontier now covers.
 *   `through` is null when the server named no update for the pull.
 */
export type ProcessedCursorTransition =
  | { readonly status: "unchanged" }
  | { readonly status: "cleared" }
  | {
      readonly dropsOtherJudges: boolean;
      readonly status: "advanced";
      readonly through: {
        readonly updateId: string;
        readonly version: string;
      } | null;
    };

export function processedCursorTransition(input: {
  /** Set when the page ended its pull. */
  readonly completedPull:
    | {
        readonly cursorSent: boolean;
        readonly throughUpdateId: string | null;
      }
    | undefined;
  /** Whether a recorded void was judged under another key for its epoch. */
  readonly keyConflict: boolean;
  /** The frontier the record holds once the page is saved. */
  readonly recordedFrontier: string;
}): ProcessedCursorTransition {
  if (input.keyConflict) return { status: "cleared" };
  if (!input.completedPull) return { status: "unchanged" };
  const { cursorSent, throughUpdateId } = input.completedPull;
  return {
    dropsOtherJudges: !cursorSent,
    status: "advanced",
    through:
      throughUpdateId === null
        ? null
        : { updateId: throughUpdateId, version: input.recordedFrontier },
  };
}
