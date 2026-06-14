import type { ApiDatabase } from "@tearleads/api-shared/postgres";
import type {
  ManagedPrincipalKind,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { runGetCurrentPrincipalPolicyWorkflow } from "../../src/workflows/principals/getCurrentPrincipalPolicy";

function verifiedPrincipalPolicyFromBundle(
  bundle: PrincipalPolicyBundleResponse,
): VerifiedPrincipalPolicy {
  const state = bundle.currentState;

  return {
    principalType: state.principalType,
    principalId: state.principalId,
    version: state.version,
    keyEpoch: state.keyEpoch,
    stateHash: state.stateHash,
    state,
    projection: bundle.currentProjection,
    checkpoint: {
      principalType: state.principalType,
      principalId: state.principalId,
      version: state.version,
      stateHash: state.stateHash,
    },
  } as unknown as VerifiedPrincipalPolicy;
}

export async function loadVerifiedPrincipalPolicy(
  db: ApiDatabase,
  principalType: ManagedPrincipalKind,
  principalId: string,
): Promise<VerifiedPrincipalPolicy> {
  return verifiedPrincipalPolicyFromBundle(
    await runGetCurrentPrincipalPolicyWorkflow(db, principalType, principalId),
  );
}
