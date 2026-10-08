import type { ReferencedPrincipalStateResponse } from "@tearleads/validators/response";

/** Bounded repair of paged stale-policy replies; identical pages never loop. */
export class PrincipalPolicyRepairBudget {
  private attempts = 0;
  private readonly seen = new Set<string>();

  take(
    references: readonly ReferencedPrincipalStateResponse[] | undefined,
  ): boolean {
    if (!references?.length || this.attempts >= 16) return false;
    const heads = references.map(
      (head) => `${head.principalType}:${head.principalId}:${head.stateHash}`,
    );
    if (heads.every((head) => this.seen.has(head))) return false;
    this.attempts++;
    for (const head of heads) this.seen.add(head);
    return true;
  }
}
