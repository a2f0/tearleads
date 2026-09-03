import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Shared vocabulary for projecting implementation runs onto the
 * RestartProbeConvergence model. Scenario tests in the packages that own the
 * seams record one step per abstract model action; when
 * RESTART_PROBE_TRACE_DIR is set the recorded traces are written as JSON for
 * scripts/checkRestartProbeProjection.ts, which generates a TLC trace-check
 * module per trace and fails on any sequence the model rejects.
 */

export type RestartProbeActionName =
  | "AcknowledgeKnownContainers"
  | "BeginProbe"
  | "DeclareKnownContainers"
  | "DisconnectEvents"
  | "FinishProbe"
  | "InitializeOpenedPersistedDocument"
  | "MarkContainerTreeReady"
  | "ReceiveInterestBaseline"
  | "RemoteBodyAdvance"
  | "RemoteSlotAdvance"
  | "Restart";

export interface RestartProbeTraceStep {
  readonly action: RestartProbeActionName;
  /** Parameter of the RemoteBodyAdvance/RemoteSlotAdvance actions. */
  readonly delivered?: boolean;
  /**
   * Implementation-projected state bits recorded after the step. The trace
   * check conjoins them onto the model action's primed state, so an
   * implementation decision that disagrees with the model rejects the trace.
   */
  readonly observed?: {
    readonly probeRequested?: boolean;
  };
}

export interface RestartProbeTrace {
  readonly model: "RestartProbeConvergence";
  readonly scenario: string;
  readonly steps: readonly RestartProbeTraceStep[];
}

export interface RestartProbeTraceRecorder {
  readonly record: (step: RestartProbeTraceStep) => void;
  readonly trace: () => RestartProbeTrace;
}

export function createRestartProbeTraceRecorder(
  scenario: string,
): RestartProbeTraceRecorder {
  const steps: RestartProbeTraceStep[] = [];
  return {
    record: (step) => {
      steps.push(step);
    },
    trace: () => ({
      model: "RestartProbeConvergence",
      scenario,
      steps: [...steps],
    }),
  };
}

/**
 * Write the recorded trace for the projection check. A normal test run (no
 * RESTART_PROBE_TRACE_DIR) records and asserts without writing anything.
 */
export function persistRestartProbeTrace(trace: RestartProbeTrace): void {
  const { RESTART_PROBE_TRACE_DIR: directory } = process.env;
  if (!directory) {
    return;
  }
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, `${trace.scenario}.json`),
    `${JSON.stringify(trace, null, 2)}\n`,
  );
}
