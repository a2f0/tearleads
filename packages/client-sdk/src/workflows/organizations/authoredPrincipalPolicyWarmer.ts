import {
  assertProjectionVerificationCurrent,
  type ReferencedPrincipalPolicyWarmer,
  type ResolvedPrincipalPolicyEvidence,
} from "../../data/keyingProjectionVerification/types";
import { principalStateMatchesReference } from "../../data/principals/principalPolicyStates";

/** Only exact, locally authored successors may resolve before their transaction commits. */
export function withAuthoredPrincipalPolicies(
  warmer: ReferencedPrincipalPolicyWarmer | undefined,
  authored: readonly ResolvedPrincipalPolicyEvidence[],
): ReferencedPrincipalPolicyWarmer | undefined {
  if (!warmer?.resolveReference || authored.length === 0) return warmer;
  const resolve = warmer.resolveReference;
  const find = (
    organizationId: string,
    reference: Parameters<typeof resolve>[0]["reference"],
  ) =>
    authored.find(
      (entry) =>
        entry.organizationId === organizationId &&
        principalStateMatchesReference(entry.policy.state, reference),
    );
  return Object.assign(
    (input: Parameters<ReferencedPrincipalPolicyWarmer>[0]) =>
      warmer({
        ...input,
        references: input.references.filter(
          (reference) => !find(input.organizationId, reference),
        ),
      }),
    {
      ...warmer,
      resolveReference: async (input: Parameters<typeof resolve>[0]) => {
        const evidence = find(input.organizationId, input.reference);
        if (!evidence) return resolve(input);
        assertProjectionVerificationCurrent(input.stillCurrent);
        assertProjectionVerificationCurrent(evidence.stillCurrent);
        return evidence;
      },
    },
  );
}
