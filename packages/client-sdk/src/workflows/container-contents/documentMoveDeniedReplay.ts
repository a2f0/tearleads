import type { ContainerContentsWorkflowRuntime } from "./runtime";

type ExecSql = ContainerContentsWorkflowRuntime["infra"]["execSql"];

interface DeniedReplayLifecycle {
  readonly lifecycleGeneration?: number | undefined;
}

interface DeniedReplayGeneration {
  execSql: ExecSql;
  lifecycleGeneration: number | undefined;
}

// One replay per store/database generation: parked denied intents flip back to
// pending ahead of its first scan (row 7). A restart loses the in-memory
// access-restored edge, and replacing the executor or lifecycle can expose a
// different durable queue. Running inside the scan keeps ordering trivially
// correct: replayed intents are attempted by this same pass, not stranded until
// an unrelated trigger. Marked complete only after the reset lands, so a
// transient failure retries on the next pass.
const deniedReplayGenerationByState = new WeakMap<
  DeniedReplayLifecycle,
  DeniedReplayGeneration
>();

export function deniedReplayMatchesGeneration(
  state: DeniedReplayLifecycle,
  execSql: ExecSql,
): boolean {
  const completed = deniedReplayGenerationByState.get(state);
  return (
    completed?.execSql === execSql &&
    completed.lifecycleGeneration === state.lifecycleGeneration
  );
}

export function markDeniedReplayGeneration(
  state: DeniedReplayLifecycle,
  execSql: ExecSql,
): void {
  deniedReplayGenerationByState.set(state, {
    execSql,
    lifecycleGeneration: state.lifecycleGeneration,
  });
}
