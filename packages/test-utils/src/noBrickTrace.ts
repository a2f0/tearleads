import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Shared vocabulary for projecting implementation runs onto the
 * NoBrickedDevice model. Scenario tests that drive the real client verifiers
 * record one step per abstract model action, with the outcome the verifier
 * produced; when NO_BRICK_TRACE_DIR is set the traces are written as JSON for
 * scripts/checkNoBrickProjection.ts, which generates a TLC trace-check module
 * per trace and fails on any sequence or outcome the model rejects.
 */

export type NoBrickOutcome = "accepted" | "refused";

/**
 * A served projection in the model's terms: the dependent head version, how
 * far its chain agrees with the honest one, the authority version its event
 * cites, whether the late signer signed it, and the authority version served
 * as current.
 */
export interface NoBrickProjection {
  readonly head: number;
  readonly honestPrefix: number;
  readonly cited: number;
  readonly late: boolean;
  readonly authority: number;
}

export type NoBrickTraceStep =
  | { readonly action: "AdvanceAuthority" }
  | { readonly action: "RevokeLateSigner" }
  | { readonly action: "CommitDependent"; readonly late: boolean }
  | { readonly action: "SyncAuthority"; readonly device: string }
  | {
      readonly action: "HonestSync";
      readonly device: string;
      readonly observed: { readonly outcome: NoBrickOutcome };
    }
  | {
      readonly action: "Verify";
      readonly device: string;
      readonly projection: NoBrickProjection;
      readonly observed: { readonly outcome: NoBrickOutcome };
    };

export interface NoBrickTrace {
  readonly model: "NoBrickedDevice";
  readonly scenario: string;
  /** Each device's initial dependent checkpoint: 1 holds the first head, 0 has no history. */
  readonly initialCheckpoints: Readonly<Record<string, 0 | 1>>;
  readonly steps: readonly NoBrickTraceStep[];
}

export interface NoBrickTraceRecorder {
  readonly record: (step: NoBrickTraceStep) => void;
  readonly trace: () => NoBrickTrace;
}

export function createNoBrickTraceRecorder(
  scenario: string,
  initialCheckpoints: Readonly<Record<string, 0 | 1>>,
): NoBrickTraceRecorder {
  const steps: NoBrickTraceStep[] = [];
  return {
    record: (step) => {
      steps.push(step);
    },
    trace: () => ({
      model: "NoBrickedDevice",
      scenario,
      initialCheckpoints: { ...initialCheckpoints },
      steps: [...steps],
    }),
  };
}

/**
 * Write the recorded trace for the projection check. A normal test run (no
 * NO_BRICK_TRACE_DIR) records and asserts without writing anything.
 */
export function persistNoBrickTrace(trace: NoBrickTrace): void {
  const { NO_BRICK_TRACE_DIR: directory } = process.env;
  if (!directory) {
    return;
  }
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, `${trace.scenario}.json`),
    `${JSON.stringify(trace, null, 2)}\n`,
  );
}
