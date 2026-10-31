import { expect, test } from "bun:test";
import {
  type AccessManifest,
  type ContainerKeyEpoch,
  computeAccessManifestHash,
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  type ReferencedPrincipalHead,
  toFingerprint,
} from "@tearleads/crypto";
import type {
  ContainerMutationRequest,
  PutPrincipalPolicyRequest,
} from "@tearleads/validators/request";
import type {
  ContainerMutationResponse,
  CurrentPrincipalMemberEnvelopesResponse,
  PrincipalStateResponse,
} from "@tearleads/validators/response";
import { buildInitialGroupPolicyRequest } from "../../../../test/helpers/groupMetadata";
import {
  policyBundleAfterMutation,
  policyBundleFromInitialRequest,
} from "../../../../test/helpers/principalPolicyFixtures";
import { createTestTrustedUserIdentity } from "../../../../test/helpers/trustedUserIdentity";
import {
  acknowledgeGroupPolicyState,
  assertGroupPolicyEnvelopesMatchAcknowledgement,
  buildAcknowledgedGroupPolicyBundle,
} from "./groupPolicyMutationAcknowledgement";
import { buildAddGroupUserPolicyRequest } from "./groupPolicyRequests";

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
  const { previousStates, ...receipt } = await policyBundleAfterMutation({
    mutation: fixture.mutation,
    previous: fixture.currentPolicy,
  });
  const bundle = {
    ...receipt,
    currentMemberEnvelopes: fixture.envelopes,
  };
  const reconstructed = await buildAcknowledgedGroupPolicyBundle({
    currentPolicy: fixture.currentPolicy,
    expectedHead: fixture.expectedHead,
    request: fixture.mutation,
    response: bundle,
  });
  expect(bundle).not.toHaveProperty("previousStates");
  expect(reconstructed.previousStates).toEqual(previousStates);
  const substituted = {
    ...bundle,
    previousStates: [
      {
        state: {
          ...fixture.currentPolicy.currentState,
          stateHash: "0".repeat(64),
        },
        projection: [],
        grants: [],
      },
    ],
  };
  expect(
    (
      await buildAcknowledgedGroupPolicyBundle({
        currentPolicy: fixture.currentPolicy,
        expectedHead: fixture.expectedHead,
        request: fixture.mutation,
        response: substituted,
      })
    ).previousStates,
  ).toEqual(previousStates);

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
  await expect(
    buildAcknowledgedGroupPolicyBundle({
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
  ).rejects.toThrow("Group member envelopes changed after acknowledgement");
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

  await expect(
    buildAcknowledgedGroupPolicyBundle({
      currentPolicy: fixture.currentPolicy,
      expectedHead: fixture.expectedHead,
      request,
      response: bundle,
    }),
  ).rejects.toThrow(
    "Group policy container acknowledgement batch is incomplete",
  );
});

test("group policy acknowledgements match container commitments by hash", async () => {
  const fixture = await acknowledgementFixture();
  const hash = (seed: string) => seed.repeat(64).slice(0, 64);
  const wrap = (recipientId: string) => ({
    containerKeyEpochId: "key-epoch",
    recipientKind: "user",
    recipientId,
    recipientKeyEpochId: `${recipientId}-key-epoch`,
    recipientKeyFingerprint: hash("f"),
    kemCipherText: "kem",
    wrappedKey: "wrapped",
    wrapManifestHash: hash("9"),
  });
  const wraps = [wrap("recipient-b"), wrap("recipient-a")];
  const keyEpoch: ContainerKeyEpoch = {
    id: "key-epoch",
    containerId: "container-1",
    keyEpoch: 2,
    accessManifestHash: hash("1"),
    parentContainerKeyEpochId: null,
    createdByEventHash: hash("2"),
    createdByManifestHash: hash("1"),
  };
  const manifest: AccessManifest = {
    version: 1,
    objectKind: "container",
    objectId: "container-1",
    organizationId: "organization-1",
    epoch: 3,
    previousManifestHash: hash("3"),
    eventHash: hash("4"),
    structuralHash: hash("5"),
    grantRoot: hash("6"),
    referencedPrincipalHeads: [],
    keyTargetHash: hash("7"),
  };
  const manifestHash = await computeAccessManifestHash(manifest);
  const containerMutation = {
    body: { eventType: "container.rekey", keyringHash: hash("8") },
    event: {},
    expectedManifestHash: manifestHash,
    keyEpoch,
    manifest,
    wraps,
  } as unknown as ContainerMutationRequest;
  const targets = (values: readonly ReturnType<typeof wrap>[]) =>
    computeContainerKekRecipientTargetHash(
      [...values]
        .map(
          ({ recipientId, recipientKeyEpochId, recipientKeyFingerprint }) => ({
            recipientId,
            recipientKeyEpochId,
            recipientKeyFingerprint,
            recipientKind: "user" as const,
          }),
        )
        .sort((left, right) =>
          left.recipientId.localeCompare(right.recipientId),
        ),
    );
  const containerResponse: ContainerMutationResponse = {
    containerId: "container-1",
    createdAt: "2026-05-05T00:00:00.000Z",
    eventHash: manifest.eventHash,
    manifestHead: { epoch: manifest.epoch, manifestHash },
    organizationId: "organization-1",
    parentId: null,
    updatedAt: "2026-05-05T00:00:00.000Z",
    containerKek: {
      containerKeyEpoch: keyEpoch.keyEpoch,
      containerKeyEpochId: keyEpoch.id,
      keyEpochHash: await computeContainerKeyEpochHash(keyEpoch),
      keyringHash: hash("8"),
      // The wraps are an unordered set: the target hash sorts them.
      keyTargetHash: await targets([...wraps].reverse()),
      parentContainerKeyEpochId: null,
    },
  };
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
  const acknowledge = (response: ContainerMutationResponse) =>
    buildAcknowledgedGroupPolicyBundle({
      currentPolicy: fixture.currentPolicy,
      expectedHead: fixture.expectedHead,
      request,
      response: { ...bundle, containerMutations: [response] },
    });

  await expect(acknowledge(containerResponse)).resolves.toBeDefined();
  // A grant that keeps its epoch (above 1) commits no keyring hash, and the
  // server names the retained keyring.
  const grant = {
    ...containerMutation,
    body: { eventType: "container.grant" },
  } as unknown as ContainerMutationRequest;
  await expect(
    buildAcknowledgedGroupPolicyBundle({
      currentPolicy: fixture.currentPolicy,
      expectedHead: fixture.expectedHead,
      request: { ...request, containerMutations: [grant] },
      response: bundle,
    }),
  ).resolves.toBeDefined();
  for (const tampered of [
    {
      ...containerResponse,
      manifestHead: {
        ...containerResponse.manifestHead,
        manifestHash: hash("0"),
      },
    },
    { ...containerResponse, eventHash: hash("0") },
    {
      ...containerResponse,
      containerKek: {
        ...containerResponse.containerKek,
        keyEpochHash: hash("0"),
      },
    },
    {
      // A keyring other than the one the signed rotation committed to.
      ...containerResponse,
      containerKek: {
        ...containerResponse.containerKek,
        keyringHash: hash("0"),
      },
    },
    {
      ...containerResponse,
      containerKek: { ...containerResponse.containerKek, keyringHash: null },
    },
    {
      // A wrap stored for someone else (#2158) changes the target hash.
      ...containerResponse,
      containerKek: {
        ...containerResponse.containerKek,
        keyTargetHash: await targets([wrap("recipient-a"), wrap("intruder")]),
      },
    },
  ]) {
    await expect(acknowledge(tampered)).rejects.toThrow(
      "Group policy container acknowledgement mismatch",
    );
  }
});
