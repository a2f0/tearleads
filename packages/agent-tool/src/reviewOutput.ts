/**
 * Severities a reviewer can sign off with. `CLEAN` is the "nothing to change"
 * verdict, so a review with no findings still has to say so explicitly rather
 * than trailing off into silence.
 */
export const REVIEW_VERDICTS = ["BLOCKER", "MAJOR", "MINOR", "CLEAN"] as const;

/**
 * A reviewer CLI can announce its intent ("I'll review this PR diff...") and then
 * stop, which `--print` emits as that lone sentence under a *success* exit code.
 * Exit status says the process ran, not that a review happened, so the reviewer
 * signs its work: every review carries a verdict line, and output without one is
 * discarded no matter how the CLI exited.
 *
 * This is a completion sentinel, not proof of work — a model that reaches the end
 * of its output can write the line without having reviewed anything. It is the
 * right instrument anyway, because the failure it guards is a cooperative model
 * that got *stopped*, and anything that cuts generation short takes a trailing
 * sentinel with it. Strictness is load-bearing: loosen the match and
 * "I'll review this and end with VERDICT: CLEAN" starts passing.
 */
const VERDICT_PATTERN = new RegExp(
  `^\\s*VERDICT:\\s*(${REVIEW_VERDICTS.join("|")})\\s*$`,
  "m",
);

/** First line of `output`, clipped so error messages stay readable. */
function preview(output: string): string {
  const firstLine = output.split("\n", 1)[0] ?? "";
  return firstLine.length > 120 ? `${firstLine.slice(0, 120)}...` : firstLine;
}

/**
 * Describe why `output` is not a usable review, or null when it is one. Callers
 * turn a non-null result into a nonzero exit so the caller's fallback chain
 * treats a degenerate review the same as a crashed one.
 */
export function reviewOutputProblem(output: string): string | null {
  const trimmed = output.trim();
  if (trimmed.length === 0) {
    return "the reviewer wrote nothing to stdout";
  }
  if (!VERDICT_PATTERN.test(trimmed)) {
    return `the reviewer never emitted a 'VERDICT:' line, so it did not finish a review (output began: ${preview(trimmed)})`;
  }
  return null;
}
