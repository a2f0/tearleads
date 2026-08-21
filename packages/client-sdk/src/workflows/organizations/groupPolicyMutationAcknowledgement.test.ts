import { expect, test } from "bun:test";
import {
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  type ReferencedPrincipalHead,
  toFingerprint,
} from "@symcrypt/crypto";
import type {
  ContainerMutationRequest,
  PutPrincipalPolicyRequest,
} from "@symcrypt/validators/request";
import type {
  ContainerMutationResponse,
  CurrentPrincipalMemberEnvelopesResponse,
  PrincipalStateResponse,
} from "@symcrypt/validators/response";
import {
  policyBundleAfterMutation,
  policyBundleFromInitialRequest,
} from "../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import {
  acknowledgeGroupPolicyState,
  assertGroupPolicyBundleMatchesAcknowledgement,
  assertGroupPolicyEnvelopesMatchAcknowledgement,
} from "./groupPolicyMutationAcknowledgement";
import { buildAddGroupUserPolicyRequest } from "./groupPolicyRequests";
import { buildInitialGroupPolicyRequest } from "./principalPolicy";

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
  const stateHash = await computePrincipalStateHash(mutation.state);
  const expectedHead: ReferencedPrincipalHead = {
    principalType: "group",
    principalId: mutation.state.principalId,
    version: mutation.state.version,
    keyEpoch: mutation.state.keyEpoch,
    stateHash,
    keyFingerprint: mutation.state.keyFingerprint,
  };
  const state: PrincipalStateResponse = {
    ...mutation.state,
    stateHash,
    createdAt: mutation.state.signedAt,
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
    request: fixture.mutation,
    response: fixture.state,
  });
  const bundle = {
    ...(await policyBundleAfterMutation({
      mutation: fixture.mutation,
      previous: fixture.currentPolicy,
    })),
    currentMemberEnvelopes: fixture.envelopes,
  };
  assertGroupPolicyBundleMatchesAcknowledgement({
    currentPolicy: fixture.currentPolicy,
    expectedHead: fixture.expectedHead,
    request: fixture.mutation,
    response: bundle,
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
  const gapRequest: PutPrincipalPolicyRequest = {
    ...fixture.mutation,
    state: {
      ...fixture.mutation.state,
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
  const alteredRequest: PutPrincipalPolicyRequest = {
    ...fixture.mutation,
    projection: [
      ...fixture.mutation.projection,
      {
        userId: crypto.randomUUID(),
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

  const bundle = await policyBundleAfterMutation({
    mutation: fixture.mutation,
    previous: fixture.currentPolicy,
  });
  expect(() =>
    assertGroupPolicyBundleMatchesAcknowledgement({
      currentPolicy: fixture.currentPolicy,
      expectedHead: fixture.expectedHead,
      request: fixture.mutation,
      response: {
        ...bundle,
        currentMemberEnvelopes: {
          ...fixture.envelopes,
          envelopes: fixture.envelopes.envelopes.slice(1),
        },
      },
    }),
  ).toThrow("Group member envelopes changed after acknowledgement");
  expect(() =>
    assertGroupPolicyEnvelopesMatchAcknowledgement(fixture.envelopes, {
      ...fixture.envelopes,
      envelopes: fixture.envelopes.envelopes.slice(1),
    }),
  ).toThrow("Group member envelopes changed after acknowledgement");
});

test("group policy acknowledgements reject an omitted container result", async () => {
  const fixture = await acknowledgementFixture();
  const bundle = await policyBundleAfterMutation({
    mutation: fixture.mutation,
    previous: fixture.currentPolicy,
  });
  const request: PutPrincipalPolicyRequest = {
    ...fixture.mutation,
    containerMutations: [{} as ContainerMutationRequest],
  };

  expect(() =>
    assertGroupPolicyBundleMatchesAcknowledgement({
      currentPolicy: fixture.currentPolicy,
      expectedHead: fixture.expectedHead,
      request,
      response: bundle,
    }),
  ).toThrow("Group policy container acknowledgement batch is incomplete");
});

test("group policy acknowledgements treat container wraps as an unordered set", async () => {
  const fixture = await acknowledgementFixture();
  const wraps = [
    { recipientId: "recipient-b", wrappedKey: "wrapped-b" },
    { recipientId: "recipient-a", wrappedKey: "wrapped-a" },
  ];
  const containerMutation = {
    body: { operation: "share" },
    event: { signature: "event-signature" },
    keyEpoch: { id: "key-epoch" },
    manifest: { manifestHash: "manifest-hash" },
    wraps,
  } as unknown as ContainerMutationRequest;
  const containerResponse = {
    accessManifest: {
      event: {
        body: containerMutation.body,
        event: containerMutation.event,
      },
      manifest: containerMutation.manifest,
    },
    containerKek: {
      keyEpoch: containerMutation.keyEpoch,
      wraps: [...wraps].reverse(),
    },
  } as unknown as ContainerMutationResponse;
  const request: PutPrincipalPolicyRequest = {
    ...fixture.mutation,
    containerMutations: [containerMutation],
  };
  const bundle = {
    ...(await policyBundleAfterMutation({
      mutation: request,
      previous: fixture.currentPolicy,
    })),
    containerMutations: [containerResponse],
  };

  expect(() =>
    assertGroupPolicyBundleMatchesAcknowledgement({
      currentPolicy: fixture.currentPolicy,
      expectedHead: fixture.expectedHead,
      request,
      response: bundle,
    }),
  ).not.toThrow();

  expect(() =>
    assertGroupPolicyBundleMatchesAcknowledgement({
      currentPolicy: fixture.currentPolicy,
      expectedHead: fixture.expectedHead,
      request,
      response: {
        ...bundle,
        containerMutations: [
          {
            ...containerResponse,
            containerKek: {
              ...containerResponse.containerKek,
              wraps: containerResponse.containerKek.wraps.slice(1),
            },
          },
        ],
      },
    }),
  ).toThrow("Group policy container acknowledgement mismatch");
});
