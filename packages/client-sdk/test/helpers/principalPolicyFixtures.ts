import { computePrincipalStateHash } from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import type { buildInitialGroupPolicyRequest } from "../../src/workflows/organizations/principalPolicy";
import type { buildInitialOrganizationPolicyRequest } from "../../src/workflows/registration/registerIdentity";

export async function policyBundleFromInitialRequest(
  request: Awaited<ReturnType<typeof buildInitialGroupPolicyRequest>>,
): Promise<PrincipalPolicyBundleResponse> {
  const stateHash = await computePrincipalStateHash(
    request.initialGroupPolicy.state,
  );

  return {
    currentState: {
      ...request.initialGroupPolicy.state,
      stateHash,
      createdAt: "2026-05-12T12:00:00.000Z",
    },
    currentPayload: {
      principalType: "group",
      principalId: request.groupId,
      stateHash,
      cipherSuite: request.initialGroupPolicy.encryptedPayload.cipherSuite,
      ciphertext: request.initialGroupPolicy.encryptedPayload.ciphertext,
      ciphertextHash:
        request.initialGroupPolicy.encryptedPayload.ciphertextHash,
      createdAt: "2026-05-12T12:00:00.000Z",
    },
    currentProjection: request.initialGroupPolicy.projection,
    currentMemberEnvelopes: {
      principalType: "group",
      principalId: request.groupId,
      stateHash,
      epoch: request.initialGroupPolicy.state.keyEpoch,
      envelopes: request.initialGroupPolicy.memberEnvelopes,
    },
    previousStates: [],
  };
}

export async function organizationPolicyBundleFromInitialRequest(
  organizationId: string,
  request: Awaited<ReturnType<typeof buildInitialOrganizationPolicyRequest>>,
): Promise<PrincipalPolicyBundleResponse> {
  const stateHash = await computePrincipalStateHash(request.state);

  return {
    currentState: {
      ...request.state,
      stateHash,
      createdAt: "2026-05-12T12:00:00.000Z",
    },
    currentPayload: {
      principalType: "organization",
      principalId: organizationId,
      stateHash,
      cipherSuite: request.encryptedPayload.cipherSuite,
      ciphertext: request.encryptedPayload.ciphertext,
      ciphertextHash: request.encryptedPayload.ciphertextHash,
      createdAt: "2026-05-12T12:00:00.000Z",
    },
    currentProjection: request.projection,
    currentMemberEnvelopes: {
      principalType: "organization",
      principalId: organizationId,
      stateHash,
      epoch: request.state.keyEpoch,
      envelopes: request.memberEnvelopes,
    },
    previousStates: [],
  };
}
