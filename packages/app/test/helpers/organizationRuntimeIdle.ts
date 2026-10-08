import type { Tearleads } from "@tearleads/client-sdk";
import { stateFor } from "../../src/providers/sdk/organizationReadModelRealtimeState";

const observedRuntimes = new Map<Tearleads, number>();

export function observeOrganizationRuntime(tearleads: Tearleads): () => void {
  observedRuntimes.set(tearleads, (observedRuntimes.get(tearleads) ?? 0) + 1);
  return () => {
    const count = (observedRuntimes.get(tearleads) ?? 1) - 1;
    if (count > 0) observedRuntimes.set(tearleads, count);
    else observedRuntimes.delete(tearleads);
  };
}

/** Reconciliation can be verifying or persisting between HTTP requests. */
export function hasPendingOrganizationRuntimeWork(): boolean {
  return [...observedRuntimes.keys()].some((tearleads) => {
    const state = stateFor(tearleads);
    return (
      state.pendingDeclaration !== null ||
      state.reconciliationsByOrganizationId.size > 0 ||
      state.deferredSelfHintByOrganizationId.size > 0 ||
      state.disconnectedFallbackByOrganizationId.size > 0
    );
  });
}
