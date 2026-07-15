import { expect, test } from "bun:test";
import {
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  type ReferencedPrincipalHead,
  toFingerprint,
} from "@tearleads/crypto";
import type { PutPrincipalStateRequest } from "@tearleads/validators/request";
import type {
  CurrentPrincipalMemberEnvelopesResponse,
  PrincipalStateResponse,
} from "@tearleads/validators/response";
import { policyBundleFromInitialRequest } from "../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import {
  acknowledgeGroupPolicyState,
  assertGroupPolicyEnvelopesMatchAcknowledgement,
  groupPolicyBundleFromAcknowledgement,
} from "./groupPolicyMutationAcknowledgement";
import {
  buildAddGroupUserPolicyRequest,
  buildInitialGroupPolicyRequest,
} from "./principalPolicy";

async function acknowledgementFixture() {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const creatorKem = generateKemSeedAndKeyPair();
  const targetKem = generateKemSeedAndKeyPair();
  const signerUserId = crypto.randomUUID();
  const signingFingerprint = await toFingerprint(
    signingKeyPair.signingPublicKey,
  );
  const initialRequest = await buildInitialGroupPolicyRequest({
    creatorEncapsulationKeyPair: creatorKem,
    groupId: crypto.randomUUID(),
    name: "Operators",
    signerUserId,
    signingFingerprint,
    signingKeyPair,
  });
  const currentPolicy = await policyBundleFromInitialRequest(initialRequest);
  const mutation = await buildAddGroupUserPolicyRequest({
    canAdministerOrganization: false,
    currentPolicy,
    currentPolicySignerPublicKeys: [
      {
        userId: signerUserId,
        signingKeyFingerprint: signingFingerprint,
        signingPublicKey: signingKeyPair.signingPublicKey,
      },
    ],
    currentUsers: [],
    currentUserSecretKey: creatorKem.secretKey,
    localPolicyCheckpoint: null,
    signerUserId,
    signingFingerprint,
    signingKeyPair,
    targetUser: createTestTrustedUserIdentity({
      userId: crypto.randomUUID(),
      encapsulationPublicKey: targetKem.publicKey,
      encapsulationKeyFingerprint: await toFingerprint(targetKem.publicKey),
      signingKeyFingerprint: signingFingerprint,
      signingPublicKey: signingKeyPair.signingPublicKey,
    }),
  });
  const stateHash = await computePrincipalStateHash(mutation.state.state);
  const expectedHead: ReferencedPrincipalHead = {
    principalType: "group",
    principalId: mutation.state.state.principalId,
    version: mutation.state.state.version,
    keyEpoch: mutation.state.state.keyEpoch,
    stateHash,
    keyFingerprint: mutation.state.state.keyFingerprint,
  };
  const state: PrincipalStateResponse = {
    ...mutation.state.state,
    stateHash,
    createdAt: mutation.state.state.signedAt,
  };
  const envelopes: CurrentPrincipalMemberEnvelopesResponse = {
    principalType: "group",
    principalId: expectedHead.principalId,
    stateHash,
    epoch: expectedHead.keyEpoch,
    envelopes: [...mutation.memberEnvelopes].reverse(),
  };
  return { currentPolicy, envelopes, expectedHead, mutation, state };
}

test("group policy acknowledgements accept only the exact authored successor", async () => {
  const fixture = await acknowledgementFixture();
  const policy = await acknowledgeGroupPolicyState({
    currentPolicy: fixture.currentPolicy,
    expectedHead: fixture.expectedHead,
    request: fixture.mutation.state,
    response: fixture.state,
  });
  const bundle = groupPolicyBundleFromAcknowledgement({
    currentPolicy: fixture.currentPolicy,
    envelopes: fixture.envelopes,
    expectedHead: fixture.expectedHead,
    memberEnvelopes: fixture.mutation.memberEnvelopes,
    state: fixture.state,
    stateRequest: fixture.mutation.state,
  });

  expect(policy.checkpoint).toEqual({
    principalType: "group",
    principalId: fixture.expectedHead.principalId,
    version: fixture.expectedHead.version,
    stateHash: fixture.expectedHead.stateHash,
  });
  expect(bundle.currentState).toEqual(fixture.state);
  expect(bundle.currentMemberEnvelopes.envelopes).toEqual(
    fixture.envelopes.envelopes,
  );
});

test("group policy state acknowledgement rejects a version gap", async () => {
  const fixture = await acknowledgementFixture();
  const gapRequest: PutPrincipalStateRequest = {
    ...fixture.mutation.state,
    state: {
      ...fixture.mutation.state.state,
      version: fixture.currentPolicy.currentState.version + 2,
    },
  };
  const gapHash = await computePrincipalStateHash(gapRequest.state);

  await expect(
    acknowledgeGroupPolicyState({
      currentPolicy: fixture.currentPolicy,
      expectedHead: {
        ...fixture.expectedHead,
        version: gapRequest.state.version,
        stateHash: gapHash,
      },
      request: gapRequest,
      response: {
        ...gapRequest.state,
        stateHash: gapHash,
        createdAt: gapRequest.state.signedAt,
      },
    }),
  ).rejects.toThrow("Group policy state acknowledgement mismatch");
});

test("group policy acknowledgements reject altered projection and envelopes", async () => {
  const fixture = await acknowledgementFixture();
  const alteredRequest: PutPrincipalStateRequest = {
    ...fixture.mutation.state,
    projection: [
      ...fixture.mutation.state.projection,
      {
        memberPrincipalType: "user",
        memberPrincipalId: crypto.randomUUID(),
        role: "member",
      },
    ],
  };
  await expect(
    acknowledgeGroupPolicyState({
      currentPolicy: fixture.currentPolicy,
      expectedHead: fixture.expectedHead,
      request: alteredRequest,
      response: fixture.state,
    }),
  ).rejects.toThrow("Authored group policy commitments are invalid");

  await expect(() =>
    groupPolicyBundleFromAcknowledgement({
      currentPolicy: fixture.currentPolicy,
      envelopes: {
        ...fixture.envelopes,
        envelopes: fixture.envelopes.envelopes.slice(1),
      },
      expectedHead: fixture.expectedHead,
      memberEnvelopes: fixture.mutation.memberEnvelopes,
      state: fixture.state,
      stateRequest: fixture.mutation.state,
    }),
  ).toThrow("Group member envelopes acknowledgement mismatch");
  expect(() =>
    assertGroupPolicyEnvelopesMatchAcknowledgement(fixture.envelopes, {
      ...fixture.envelopes,
      envelopes: fixture.envelopes.envelopes.slice(1),
    }),
  ).toThrow("Group member envelopes changed after acknowledgement");
});
