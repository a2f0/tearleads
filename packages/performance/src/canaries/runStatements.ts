/**
 * What `--statements` counted for one canary run:
 * - `off`: capture was off, or the run did not pass, so nothing was counted;
 * - `unmatched`: the capture is missing, unreadable, or its phase markers do
 *   not match the profile (a truncated capture, or a test that replaced
 *   `console.info`);
 * - `captured`: statements per profiled phase, in the profile's order.
 */
export type RunStatements =
  | { readonly status: "off" }
  | { readonly status: "unmatched"; readonly capture: string }
  | {
      readonly status: "captured";
      readonly capture: string;
      readonly perPhase: readonly number[];
    };

/** The statements a run counted in the phase at `index`, if it counted any. */
export function phaseStatementCount(
  statements: RunStatements | undefined,
  index: number,
): number | undefined {
  return statements?.status === "captured"
    ? statements.perPhase[index]
    : undefined;
}
