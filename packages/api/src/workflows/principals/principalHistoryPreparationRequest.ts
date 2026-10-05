import type { PrincipalHistoryVerificationKind } from "@tearleads/api-shared/schema";
import type { ReferencedPrincipalHead } from "@tearleads/crypto";

export interface PrincipalHistoryPreparationRequest {
  readonly head: ReferencedPrincipalHead;
  readonly kind: PrincipalHistoryVerificationKind;
  readonly retainedReferences: readonly ReferencedPrincipalHead[];
}

export interface PrincipalHistoryPreparationPending {
  readonly complete: false;
  readonly request: PrincipalHistoryPreparationRequest;
}

/** Internal control flow; never a claim that an operation committed. */
export class PrincipalHistoryPreparationRequired extends Error {
  readonly request: PrincipalHistoryPreparationRequest;

  constructor(request: PrincipalHistoryPreparationRequest) {
    super("Principal history preparation is required");
    this.name = "PrincipalHistoryPreparationRequired";
    this.request = structuredClone(request);
  }
}
