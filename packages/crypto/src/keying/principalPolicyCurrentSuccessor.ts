import { normalizePrincipalPolicyStateChainEntry } from "./principalPolicyChainEntry";
import {
  issueVerifiedPrincipalPolicyCurrent,
  ownVerifiedPrincipalPolicyCurrent,
} from "./principalPolicyCurrentEvidence";
import type { PrincipalPolicyExternalAuthority } from "./principalPolicyExternalAuthorityTypes";
import { verifyPrincipalHistoryPage } from "./principalPolicyHistoryPage";
import { verifyPrincipalPolicyMemberEnvelopes } from "./principalPolicyMemberEnvelopes";
import { verifyPrincipalPolicyPayload } from "./principalPolicyPayload";
import type {
  PrincipalPolicyCurrent,
  VerifiedPrincipalPolicyCurrent,
} from "./principalPolicyTypes";
import { runVerifier } from "./shared";
import type {
  KeyingVerificationResult,
  PrincipalPolicySignerPublicKey,
} from "./types";

/** Verify one successor of locally verified current evidence, retaining only that pair. */
export function verifyPrincipalPolicyCurrentSuccessor(input: {
  readonly previous: VerifiedPrincipalPolicyCurrent;
  readonly current: PrincipalPolicyCurrent;
  readonly signerPublicKeys: readonly PrincipalPolicySignerPublicKey[];
  readonly externalAuthority?: PrincipalPolicyExternalAuthority | undefined;
}): Promise<KeyingVerificationResult<VerifiedPrincipalPolicyCurrent>> {
  return runVerifier(async () => {
    const prior = ownVerifiedPrincipalPolicyCurrent(input.previous);
    const current = structuredClone(input.current);
    const signerPublicKeys = structuredClone(input.signerPublicKeys);
    const externalAuthority = structuredClone(input.externalAuthority);
    const previous = await normalizePrincipalPolicyStateChainEntry({
      state: prior.policy.state,
      projection: prior.policy.projection,
      grants: prior.policy.grants,
    });
    const checked = await verifyPrincipalHistoryPage({
      principalId: prior.policy.principalId,
      principalType: prior.policy.principalType,
      previous,
      latestAuthority: prior.latestAuthority,
      references: [],
      checkpoint: null,
      page: {
        entries: [
          {
            state: current.currentState,
            projection: current.currentProjection,
            grants: current.currentGrants,
          },
        ],
        signerPublicKeys,
        ...(externalAuthority ? { externalAuthority } : {}),
      },
    });
    await verifyPrincipalPolicyPayload({ bundle: current });
    await verifyPrincipalPolicyMemberEnvelopes({ bundle: current });
    const { state, projection, grants } = checked.last;
    return issueVerifiedPrincipalPolicyCurrent(
      {
        principalId: state.principalId,
        principalType: state.principalType,
        version: state.version,
        keyEpoch: state.keyEpoch,
        stateHash: state.stateHash,
        state,
        projection,
        grants,
        retainedHistory: [previous, checked.last],
        checkpoint: {
          principalId: state.principalId,
          principalType: state.principalType,
          version: state.version,
          stateHash: state.stateHash,
        },
      },
      checked.latestAuthority,
    );
  });
}
