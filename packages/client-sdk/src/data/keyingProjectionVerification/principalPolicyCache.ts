import type {
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { loadPrincipalPolicyBundle } from "../persistence/principalPolicyPersistence";
import type { ExecSql } from "../sqlite/sqlSchema";

function referencedPrincipalPolicyKey(
  reference: ReferencedPrincipalHead,
): string {
  return `${reference.principalType}:${reference.principalId}:${reference.version}:${reference.stateHash}`;
}

function principalPolicyBundleStates(
  bundle: PrincipalPolicyBundleResponse,
): PrincipalPolicyBundleResponse["currentState"][] {
  return [
    ...bundle.previousStates.map((entry) => entry.state),
    bundle.currentState,
  ];
}

function principalPolicyBundleContainsReference(
  bundle: PrincipalPolicyBundleResponse,
  reference: ReferencedPrincipalHead,
): boolean {
  return principalPolicyBundleStates(bundle).some(
    (state) =>
      state.principalType === reference.principalType &&
      state.principalId === reference.principalId &&
      state.version === reference.version &&
      state.keyEpoch === reference.keyEpoch &&
      state.stateHash === reference.stateHash &&
      state.keyFingerprint === reference.keyFingerprint,
  );
}

// Identify which referenced policies are absent from both the in-memory cache
// and local storage, so the warmer fetches only what is genuinely missing.
export async function filterUncachedPrincipalPolicyReferences(input: {
  execSql: ExecSql;
  principalPolicyCache: ReadonlyMap<string, VerifiedPrincipalPolicy>;
  references: readonly ReferencedPrincipalHead[];
}): Promise<ReferencedPrincipalHead[]> {
  const results = await Promise.all(
    input.references.map(async (reference) => {
      if (
        input.principalPolicyCache.has(referencedPrincipalPolicyKey(reference))
      ) {
        return null;
      }
      const bundle = await loadPrincipalPolicyBundle(
        input.execSql,
        reference.principalType,
        reference.principalId,
      );
      return bundle && principalPolicyBundleContainsReference(bundle, reference)
        ? null
        : reference;
    }),
  );
  return results.filter(
    (reference): reference is ReferencedPrincipalHead => reference !== null,
  );
}
