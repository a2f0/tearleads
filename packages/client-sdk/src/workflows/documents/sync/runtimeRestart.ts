import { processLoroRuntimeHealth } from "../../../data/documents/shared/sync/loroRuntimeHealth";
import type { LoroRuntimeHealth } from "../../../data/documents/shared/sync/loroRuntimeHealthMachine";

/**
 * Where this realm's runtime stands toward a restart (#3194):
 * `restartRequired` once a Loro runtime failure left the module suspect,
 * `draining` while `prepareRuntimeRestart` waits for read windows, `ready`
 * once the host may restart, and `restartRequired` again once the restart's
 * hold ends in a realm its host kept running.
 */
export type RuntimeHealthStatus = LoroRuntimeHealth["status"];

/** This realm's runtime health. */
export function getRuntimeHealth(): RuntimeHealthStatus {
  return processLoroRuntimeHealth.current().status;
}

/** Calls `listener` on every change of the runtime health. */
export function subscribeRuntimeHealth(listener: () => void): () => void {
  return processLoroRuntimeHealth.subscribe(listener);
}

/**
 * Prepares this realm for a restart its user asked for: no Loro read window
 * opens until the open ones close, or a bounded wait ends, and then for a
 * few seconds more, so a reload that follows at once leaves none open.
 * Resolves once the host may reload, at once in a healthy realm; never
 * rejects. The SDK never restarts the realm itself.
 */
export function prepareRuntimeRestart(): Promise<void> {
  return processLoroRuntimeHealth.prepareRestart();
}
