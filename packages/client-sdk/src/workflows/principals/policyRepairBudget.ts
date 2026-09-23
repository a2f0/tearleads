import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";

/** Bounded repair of paged stale-policy replies; identical pages never loop. */
export class PrincipalPolicyRepairBudget {
  private attempts = 0;
  private readonly seen = new Set<string>();

  take(bundles: readonly PrincipalPolicyBundleResponse[] | undefined): boolean {
    if (!bundles?.length || this.attempts >= 16) return false;
    const heads = bundles.map(
      ({ currentState }) =>
        `${currentState.principalType}:${currentState.principalId}:${currentState.stateHash}`,
    );
    if (heads.every((head) => this.seen.has(head))) return false;
    this.attempts++;
    for (const head of heads) this.seen.add(head);
    return true;
  }
}
