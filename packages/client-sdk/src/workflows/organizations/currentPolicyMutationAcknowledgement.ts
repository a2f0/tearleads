import {
  type PrincipalPolicyCheckpoint,
  type PrincipalPolicyExternalAuthority,
  type PrincipalPolicySignerPublicKey,
  type ReferencedPrincipalHead,
  type VerifiedPrincipalPolicyCurrent,
  verifyPrincipalPolicyCheckpoint,
  verifyPrincipalPolicyCurrentSuccessor,
} from "@tearleads/crypto";
import type { PutPrincipalPolicyRequest } from "@tearleads/validators/request";
import type { PrincipalStateResponse } from "@tearleads/validators/response";
import { canonicalKeyingJsonString } from "../../data/keyingCanonicalJson";
import { assertProjectionVerificationCurrent } from "../../data/keyingProjectionVerification/types";
import { assertPrincipalPolicyCurrentStateMatchesHead } from "./groupPolicyMutationHead";

export interface CurrentPolicyMutationInput {
  readonly currentPolicy?: never;
  readonly verifiedCurrentPolicy: VerifiedPrincipalPolicyCurrent;
  readonly expectedHead: ReferencedPrincipalHead;
  readonly request: PutPrincipalPolicyRequest;
  readonly signerPublicKeys: readonly PrincipalPolicySignerPublicKey[];
  readonly externalAuthority?: PrincipalPolicyExternalAuthority | undefined;
  readonly localPolicyCheckpoint?: PrincipalPolicyCheckpoint | null;
  readonly stillCurrent: () => boolean;
}

/** Verify a single authored successor; this neither admits it nor persists a pin. */
export async function verifyCurrentPolicyMutation(
  input: CurrentPolicyMutationInput,
  acknowledgedState?: PrincipalStateResponse,
): Promise<VerifiedPrincipalPolicyCurrent> {
  const previous = input.verifiedCurrentPolicy;
  const stillCurrent = input.stillCurrent;
  const owned = structuredClone({
    expectedHead: input.expectedHead,
    request: input.request,
    signerPublicKeys: input.signerPublicKeys,
    externalAuthority: input.externalAuthority,
    localPolicyCheckpoint: input.localPolicyCheckpoint,
    acknowledgedState,
  });
  assertProjectionVerificationCurrent(stillCurrent);
  const { request, expectedHead } = owned;
  const state = owned.acknowledgedState ?? {
    ...request.state,
    stateHash: expectedHead.stateHash,
    createdAt: request.state.signedAt,
  };
  if (owned.acknowledgedState) {
    const { createdAt: _createdAt, stateHash, ...responseState } = state;
    if (
      stateHash !== expectedHead.stateHash ||
      canonicalKeyingJsonString(responseState, "stored group policy state") !==
        canonicalKeyingJsonString(request.state, "authored group policy state")
    )
      throw new Error("Group policy state acknowledgement mismatch");
  }
  const verified = await verifyPrincipalPolicyCurrentSuccessor({
    previous,
    signerPublicKeys: owned.signerPublicKeys,
    externalAuthority: owned.externalAuthority,
    current: {
      currentState: state,
      currentProjection: request.projection,
      currentGrants: request.grants,
      currentPayload: {
        ...request.encryptedPayload,
        principalId: state.principalId,
        principalType: state.principalType,
        stateHash: state.stateHash,
      },
      currentMemberEnvelopes: {
        envelopes: request.memberEnvelopes,
        principalId: state.principalId,
        principalType: state.principalType,
        stateHash: state.stateHash,
        epoch: state.keyEpoch,
      },
    },
  });
  if (!verified.ok) throw verified.error;
  assertPrincipalPolicyCurrentStateMatchesHead(
    verified.value.state,
    expectedHead,
  );
  verifyPrincipalPolicyCheckpoint({
    chain: verified.value.retainedHistory,
    currentState: verified.value.state,
    localCheckpoint: owned.localPolicyCheckpoint,
  });
  assertProjectionVerificationCurrent(stillCurrent);
  return verified.value;
}
