interface IdentityTransitionTraceLogger {
  readonly log: (message: string) => void;
}

export type IdentityTransitionKind = "import" | "switch";

type IdentityTransitionPhase =
  | "database-ready"
  | "database-wait-started"
  | "rollback-database-ready"
  | "rollback-started"
  | "runtime-prepared"
  | "session-persisted"
  | "started"
  | "target-loaded";

type IdentityTransitionRollback =
  | "failed"
  | "not-needed"
  | "succeeded"
  | "superseded"
  | "unavailable";

/**
 * Content-free transition telemetry copied into System Monitor reports.
 * Fingerprints, database names, sessions, and free-form errors are deliberately
 * absent; the generation only correlates phases within the current app boot.
 */
export const IDENTITY_TRANSITION_TRACE_FRAGMENT =
  "identity transition generation=\\d+ kind=(?:import|switch) " +
  "(?:phase=(?:database-ready|database-wait-started|rollback-database-ready|rollback-started|runtime-prepared|session-persisted|started|target-loaded)|result=succeeded|result=failed rollback=(?:failed|not-needed|succeeded|superseded|unavailable))";

function prefix(generation: number, kind: IdentityTransitionKind): string {
  return `identity transition generation=${generation} kind=${kind}`;
}

export function logIdentityTransitionPhase(
  logger: IdentityTransitionTraceLogger,
  generation: number,
  kind: IdentityTransitionKind,
  phase: IdentityTransitionPhase,
): void {
  logger.log(`${prefix(generation, kind)} phase=${phase}`);
}

export function logIdentityTransitionResult(
  logger: IdentityTransitionTraceLogger,
  generation: number,
  kind: IdentityTransitionKind,
  result:
    | { readonly status: "succeeded" }
    | {
        readonly rollback: IdentityTransitionRollback;
        readonly status: "failed";
      },
): void {
  logger.log(
    result.status === "succeeded"
      ? `${prefix(generation, kind)} result=succeeded`
      : `${prefix(generation, kind)} result=failed rollback=${result.rollback}`,
  );
}
