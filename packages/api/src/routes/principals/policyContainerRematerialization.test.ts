import { expect, test } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import { createTestUser } from "@tearleads/bob-and-alice";
import {
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  makeVerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import { base64ToBytes } from "@tearleads/encoding";
import { authenticate } from "../../../test/helpers/authenticate";
import { buildPrincipalGrantRefreshRequest } from "../../../test/helpers/containerGrantRefresh";
import { buildRootContainerRekeyMutation } from "../../../test/helpers/containerRekey";
import {
  asVerifiedContainerManifest,
  bootstrapRoot,
} from "../../../test/helpers/keyingWriterProjectionKit";
import { createSignedPrincipalState } from "../../../test/helpers/principalPolicy";
import { registerUser } from "../../../test/helpers/registerUser";
import { getCurrentContainerKeyEpoch } from "../../access/read/containerKekStore";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { routeApp } from "../../routeApp";

async function prepareRotation(input: { rotateKey?: boolean } = {}) {
  const owner = createTestUser();
  await registerUser(owner);
  await authenticate(owner);
  const root = await bootstrapRoot(owner);
  const currentPolicy = root.principalPolicies[0];
  if (!currentPolicy) {
    throw new Error("Expected the root Admins policy");
  }
  const rotatesKey = input.rotateKey ?? true;
  const generatedPrincipalKem = generateKemSeedAndKeyPair();
  const principalKem = rotatesKey
    ? generatedPrincipalKem
    : {
        publicKey: base64ToBytes(currentPolicy.state.encapsulationPublicKey),
        secretKey: generatedPrincipalKem.secretKey,
      };
  const signed = await createSignedPrincipalState({
    principalType: currentPolicy.principalType,
    principalId: currentPolicy.principalId,
    principalKem,
    version: currentPolicy.version + 1,
    prevStateHash: currentPolicy.stateHash,
    keyEpoch: currentPolicy.keyEpoch + (rotatesKey ? 1 : 0),
    members: currentPolicy.projection.map((member) => ({
      userId: member.userId,
    })),
    projection: [...currentPolicy.projection],
    grants: [...currentPolicy.grants],
    signerUserId: owner.userId,
    signerUserKeyFingerprint: owner.fingerprint,
    signingPrivateKey: owner.signing.signingPrivateKey,
  });
  const stateHash = await computePrincipalStateHash(signed.state);
  const nextState = {
    ...signed.state,
    stateHash,
    createdAt: signed.state.signedAt,
  };
  const nextPolicy = makeVerifiedPrincipalPolicy({
    principalType: nextState.principalType,
    principalId: nextState.principalId,
    version: nextState.version,
    keyEpoch: nextState.keyEpoch,
    stateHash,
    state: nextState,
    projection: signed.projection,
    grants: signed.grants,
    history: [
      {
        state: currentPolicy.state,
        projection: currentPolicy.projection,
        grants: currentPolicy.grants,
      },
      {
        state: nextState,
        projection: signed.projection,
        grants: signed.grants,
      },
    ],
    checkpoint: {
      principalType: nextState.principalType,
      principalId: nextState.principalId,
      version: nextState.version,
      stateHash,
    },
  });
  const rootRekey = rotatesKey
    ? await buildRootContainerRekeyMutation({
        previous: root,
        replacementPrincipalPolicy: nextPolicy,
        signer: owner,
      })
    : {
        bundle: root.bundle,
        request: await buildPrincipalGrantRefreshRequest({
          parentKekState: null,
          previous: root.bundle,
          previousContainerPath: [root.bundle],
          previousKekState: root.kekState,
          replacementPrincipalPolicy: nextPolicy,
          signer: owner,
        }),
        kekState: root.kekState,
      };
  return { currentPolicy, nextPolicy, owner, root, rootRekey, signed };
}

function putPolicy(
  input: Awaited<ReturnType<typeof prepareRotation>>,
  containerMutations = [input.rootRekey.request],
) {
  return routeApp.request(
    `/principals/group/${input.nextPolicy.principalId}/policy`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${input.owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        state: input.signed.state,
        encryptedPayload: input.signed.encryptedPayload,
        projection: input.signed.projection,
        grants: input.signed.grants,
        memberEnvelopes: input.signed.memberEnvelopes,
        containerMutations,
      }),
    },
  );
}

test("policy rotation and dependent container rekey commit atomically", async () => {
  const prepared = await prepareRotation();
  const previousKek = await getCurrentContainerKeyEpoch(
    prepared.root.kekState.containerId,
    db,
  );

  const response = await putPolicy(prepared);

  expect(response.status, await response.clone().text()).toBe(200);
  expect(
    (
      await getCurrentPrincipalState(
        "group",
        prepared.nextPolicy.principalId,
        db,
      )
    )?.stateHash,
  ).toBe(prepared.nextPolicy.stateHash);
  const currentKek = await getCurrentContainerKeyEpoch(
    prepared.root.kekState.containerId,
    db,
  );
  expect(currentKek?.id).toBe(prepared.rootRekey.kekState.containerKeyEpochId);
  expect(currentKek?.id).not.toBe(previousKek?.id);
  expect(
    asVerifiedContainerManifest(prepared.rootRekey.bundle).state
      .referencedPrincipalHeads,
  ).toContainEqual({
    principalType: prepared.nextPolicy.principalType,
    principalId: prepared.nextPolicy.principalId,
    version: prepared.nextPolicy.version,
    keyEpoch: prepared.nextPolicy.keyEpoch,
    stateHash: prepared.nextPolicy.stateHash,
    keyFingerprint: prepared.nextPolicy.state.keyFingerprint,
  });
}, 15_000);

test("an exact compound policy replay survives a later container mutation", async () => {
  const prepared = await prepareRotation();
  expect((await putPolicy(prepared)).status).toBe(200);
  if (!("container" in prepared.rootRekey)) {
    throw new Error("Expected a rotating principal policy mutation");
  }
  const laterRekey = await buildRootContainerRekeyMutation({
    previous: prepared.rootRekey.container,
    signer: prepared.owner,
  });
  const laterResponse = await routeApp.request(
    `/containers/${prepared.root.kekState.containerId}/rekey`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${prepared.owner.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(laterRekey.request),
    },
  );
  expect(laterResponse.status, await laterResponse.clone().text()).toBe(200);

  const replayResponse = await putPolicy(prepared);
  expect(replayResponse.status).toBe(200);
  const replay = await replayResponse.json();
  expect(replay.containerMutations).toHaveLength(1);
  expect(replay.containerMutations[0]?.accessManifest.manifestHash).toBe(
    prepared.rootRekey.bundle.manifestHash,
  );
  expect(replay.containerMutations[0]?.containerKek.containerKeyEpochId).toBe(
    prepared.rootRekey.kekState.containerKeyEpochId,
  );
  expect(
    (await getCurrentContainerKeyEpoch(prepared.root.kekState.containerId, db))
      ?.id,
  ).toBe(laterRekey.kekState.containerKeyEpochId);
}, 15_000);

test("same-key-epoch policy successors refresh grants without rekeying", async () => {
  const prepared = await prepareRotation({ rotateKey: false });
  const previousKek = await getCurrentContainerKeyEpoch(
    prepared.root.kekState.containerId,
    db,
  );

  expect(Reflect.get(prepared.rootRekey.request.event, "eventType")).toBe(
    "container.grant",
  );
  expect((await putPolicy(prepared)).status).toBe(200);
  expect(
    (await getCurrentContainerKeyEpoch(prepared.root.kekState.containerId, db))
      ?.id,
  ).toBe(previousKek?.id);
}, 15_000);

test("a missing dependent mutation rolls back the principal rotation", async () => {
  const prepared = await prepareRotation();
  const previousKek = await getCurrentContainerKeyEpoch(
    prepared.root.kekState.containerId,
    db,
  );
  const response = await putPolicy(prepared, []);

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "Principal policy must rematerialize every stale container grant",
  });
  expect(
    (
      await getCurrentPrincipalState(
        "group",
        prepared.currentPolicy.principalId,
        db,
      )
    )?.stateHash,
  ).toBe(prepared.currentPolicy.stateHash);
  expect(
    (await getCurrentContainerKeyEpoch(prepared.root.kekState.containerId, db))
      ?.id,
  ).toBe(previousKek?.id);
}, 15_000);

test("a failed dependent mutation rolls back every policy artifact", async () => {
  const prepared = await prepareRotation();
  const previousKek = await getCurrentContainerKeyEpoch(
    prepared.root.kekState.containerId,
    db,
  );
  const invalidMutation = {
    ...prepared.rootRekey.request,
    body: {
      ...(prepared.rootRekey.request.body as Record<string, unknown>),
      keyringHash: "0".repeat(64),
    },
  };

  const response = await putPolicy(prepared, [invalidMutation]);

  expect(response.status).toBe(409);
  expect(
    (
      await getCurrentPrincipalState(
        "group",
        prepared.currentPolicy.principalId,
        db,
      )
    )?.stateHash,
  ).toBe(prepared.currentPolicy.stateHash);
  expect(
    (await getCurrentContainerKeyEpoch(prepared.root.kekState.containerId, db))
      ?.id,
  ).toBe(previousKek?.id);
}, 15_000);
