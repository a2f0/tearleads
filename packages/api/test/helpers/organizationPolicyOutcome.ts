import type { TestUser } from "@tearleads/bob-and-alice";
import { signPrincipalState } from "@tearleads/crypto";
import { PrincipalPolicyBundleResponseSchema } from "@tearleads/validators/response";
import { getPolicy } from "./principalPolicyReadFixtures";

export async function prepareOrganizationPolicyAdvance(
  actor: TestUser,
  organizationId: string,
) {
  const original = PrincipalPolicyBundleResponseSchema.parse(
    await (await getPolicy(actor, "organization", organizationId)).json(),
  );
  const state = await signPrincipalState(
    {
      ...original.currentState,
      version: original.currentState.version + 1,
      prevStateHash: original.currentState.stateHash,
      signerUserId: actor.userId,
      signerUserKeyFingerprint: actor.fingerprint,
    },
    actor.signing.signingPrivateKey,
  );
  const body = {
    state,
    encryptedPayload: {
      cipherSuite: original.currentPayload.cipherSuite,
      ciphertext: original.currentPayload.ciphertext,
      ciphertextHash: original.currentPayload.ciphertextHash,
    },
    projection: original.currentProjection,
    grants: original.currentGrants,
    memberEnvelopes: original.currentMemberEnvelopes.envelopes,
    containerMutations: [],
  };
  return {
    body,
    path: `/principals/organization/${organizationId}/policy`,
    init: {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${actor.token}`,
      },
      body: JSON.stringify(body),
    },
  };
}
