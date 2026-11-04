import { expect } from "bun:test";
import type {
  AccessEvent,
  ContainerAccessManifestState,
  ContainerKeyEpoch,
} from "@tearleads/crypto";
import {
  computeAccessEventHash,
  computeAccessManifestHash,
  deriveContainerAccessManifest,
} from "@tearleads/crypto";
import { createTestUser } from "@tearleads/test-utils";
import { userRecipientKey } from "../../../test/helpers/containerGrantMutation";
import { createContainerKeyWrap } from "../../../test/helpers/containerKeying";
import {
  asVerifiedContainerManifest,
  buildRekeyRequest,
} from "../../../test/helpers/containerMutationRotations";
import {
  accessManifestFromResponse,
  createChild,
  expectMutationSuccess,
  kekStateFromResponse,
  postMutation,
  registerAndAuthenticate,
  test,
} from "../../../test/helpers/containerMutationRoutes";
import { bootstrapRoot } from "../../../test/helpers/keyingWriterProjectionKit";
import type { StoredContainerMutation } from "../../../test/helpers/storedContainerMutation";

test("POST /containers/:containerId/rekey materializes a writer KEK rotation", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);

  const root = await bootstrapRoot(owner);
  const created = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const childBundle = accessManifestFromResponse(created);
  const childKek = kekStateFromResponse(created);
  const request = await buildRekeyRequest({
    parentKekState: root.kekState,
    previous: childBundle,
    previousContainerPath: [root.bundle, childBundle],
    previousKekState: childKek,
    signer: owner,
  });

  const rekeyed = await expectMutationSuccess(
    await postMutation({
      path: `/containers/${created.containerId}/rekey`,
      request,
      token: owner.token,
    }),
  );

  expect(rekeyed.manifestHead.epoch).toBe(2);
  expect(rekeyed.parentId).toBe(root.kekState.containerId);
  expect(rekeyed.containerKek.containerKeyEpoch).toBe(
    childKek.containerKeyEpoch + 1,
  );
  expect(rekeyed.containerKek.containerKeyEpochId).not.toBe(
    childKek.containerKeyEpochId,
  );
  expect(rekeyed.containerKek.keyring).toEqual(
    request.keyring as StoredContainerMutation["containerKek"]["keyring"],
  );
  expect(rekeyed.containerKek.recipientTargets).toEqual([
    {
      recipientKind: "container",
      recipientId: root.kekState.containerId,
      recipientKeyEpochId: root.kekState.containerKeyEpochId,
      recipientKeyFingerprint: root.kekState.keyEpochHash,
    },
  ]);
});

test("POST /containers/:containerId/rekey rejects recipient-set changes", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);

  const root = await bootstrapRoot(owner);
  const created = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const childBundle = accessManifestFromResponse(created);
  const request = await buildRekeyRequest({
    parentKekState: root.kekState,
    previous: childBundle,
    previousContainerPath: [root.bundle, childBundle],
    previousKekState: kekStateFromResponse(created),
    signer: owner,
  });
  const previous = asVerifiedContainerManifest(childBundle);
  const event = request.event as unknown as AccessEvent;
  const body = request.body as {
    readonly containerKeyEpochId: string;
    readonly containerKeyPublicKey: string;
  };
  const tamperedManifestState: ContainerAccessManifestState = {
    ...previous.state,
    epoch: previous.state.epoch + 1,
    previousManifestHash: childBundle.manifestHash,
    eventHash: await computeAccessEventHash(event),
    containerKeyEpochId: body.containerKeyEpochId,
    containerKeyPublicKey: body.containerKeyPublicKey,
    directGrants: [
      ...previous.state.directGrants,
      {
        accessLevel: "read",
        subjectId: owner.userId,
        subjectType: "user",
      },
    ],
  };
  const tamperedManifest = await deriveContainerAccessManifest(
    tamperedManifestState,
  );
  request.manifest = tamperedManifest as unknown as Record<string, unknown>;
  request.expectedManifestHash =
    await computeAccessManifestHash(tamperedManifest);

  const response = await postMutation({
    path: `/containers/${created.containerId}/rekey`,
    request,
    token: owner.token,
  });

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "container access manifest hash does not match derived state",
  });
});

test("POST /containers/:containerId/rekey rejects KEK wraps outside the verified target set", async () => {
  const owner = createTestUser();
  await registerAndAuthenticate(owner);

  const root = await bootstrapRoot(owner);
  const created = await createChild({
    parent: root.bundle,
    parentKekState: root.kekState,
    signer: owner,
  });
  const childBundle = accessManifestFromResponse(created);
  const request = await buildRekeyRequest({
    parentKekState: root.kekState,
    previous: childBundle,
    previousContainerPath: [root.bundle, childBundle],
    previousKekState: kekStateFromResponse(created),
    signer: owner,
  });
  const ownerRecipientKey = await userRecipientKey(owner);
  const keyEpoch = request.keyEpoch as unknown as ContainerKeyEpoch;
  request.wraps = [
    ...request.wraps,
    createContainerKeyWrap({
      containerKeyEpochId: keyEpoch.id,
      recipientKind: "user",
      recipientId: ownerRecipientKey.userId,
      recipientKeyEpochId: ownerRecipientKey.recipientKeyEpochId,
      recipientKeyFingerprint: ownerRecipientKey.recipientKeyFingerprint,
      wrapManifestHash: request.expectedManifestHash,
    }) as unknown as Record<string, unknown>,
  ];

  const response = await postMutation({
    path: `/containers/${created.containerId}/rekey`,
    request,
    token: owner.token,
  });

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    error: "container key wrap is not justified by its manifest",
  });
});
