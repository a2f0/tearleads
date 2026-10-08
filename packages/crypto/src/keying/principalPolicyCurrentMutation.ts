import { normalizePrincipalPolicyStateChainEntry } from "./principalPolicyChainEntry";
import {
  issueVerifiedPrincipalPolicyCurrent,
  ownVerifiedPrincipalPolicyCurrent,
} from "./principalPolicyCurrentEvidence";
import {
  createPrincipalPolicyExternalAuthorityVerifier,
  externalAuthorityIncludesAdminSigner,
  verifyPrincipalPolicyExternalAuthorityProgress,
} from "./principalPolicyExternalAuthority";
import type { PrincipalPolicyExternalAuthority } from "./principalPolicyExternalAuthorityTypes";
import { verifyPrincipalPolicyMemberEnvelopes } from "./principalPolicyMemberEnvelopes";
import { verifyPrincipalPolicyPayload } from "./principalPolicyPayload";
import { principalPolicyStateMatchesReference } from "./principalPolicyReference";
import type {
  PrincipalPolicyCurrent,
  VerifiedPrincipalPolicyCurrent,
} from "./principalPolicyTypes";
import { runVerifier, throwVerification } from "./shared";
import type { KeyingVerificationResult } from "./types";

/** Bind a group's current artifacts and next signer to privately issued evidence. */
export function verifyPrincipalPolicyCurrentMutation(input: {
  readonly current: PrincipalPolicyCurrent;
  readonly policy: VerifiedPrincipalPolicyCurrent;
  readonly signerUserId: string;
  readonly externalAuthority?: PrincipalPolicyExternalAuthority | undefined;
}): Promise<KeyingVerificationResult<VerifiedPrincipalPolicyCurrent>> {
  return runVerifier(async () => {
    const prior = ownVerifiedPrincipalPolicyCurrent(input.policy);
    const current = structuredClone(input.current);
    const externalAuthority = structuredClone(input.externalAuthority);
    const signerUserId = input.signerUserId;
    const entry = await normalizePrincipalPolicyStateChainEntry({
      state: current.currentState,
      projection: current.currentProjection,
      grants: current.currentGrants,
    });
    if (
      !principalPolicyStateMatchesReference(entry.state, prior.policy.state) ||
      entry.state.signature !== prior.policy.state.signature
    )
      throwVerification(
        "hash_mismatch",
        "current artifacts differ from issued policy evidence",
      );
    if (entry.state.principalType !== "group")
      throwVerification(
        "object_mismatch",
        "group mutation requires a group policy",
      );
    await verifyPrincipalPolicyPayload({ bundle: current });
    await verifyPrincipalPolicyMemberEnvelopes({ bundle: current });
    if (
      !entry.projection.some(
        (member) => member.userId === signerUserId && member.role === "admin",
      )
    ) {
      const authority = createPrincipalPolicyExternalAuthorityVerifier({
        authority: externalAuthority,
      });
      authority.latestReference = prior.latestAuthority;
      const next = {
        state: {
          signerUserId,
          externalAuthority: externalAuthority?.currentHead ?? null,
        },
      };
      verifyPrincipalPolicyExternalAuthorityProgress({
        entry: next,
        verifier: authority,
      });
      if (
        !externalAuthorityIncludesAdminSigner({
          entry: next,
          verifier: authority,
        })
      )
        throwVerification(
          "unauthorized",
          "group mutation signer is not an authority admin",
        );
    }
    return issueVerifiedPrincipalPolicyCurrent(
      prior.policy,
      prior.latestAuthority,
    );
  });
}
