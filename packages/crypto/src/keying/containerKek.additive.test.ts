import { expect, test } from "bun:test";
import { fixtureContainerKekMaterialId } from "./containerKekMaterial.testFixtures";
import type { ContainerUserRecipientKey } from "./index";
import { verifyContainerKekState } from "./index";
import {
  createContainerKeyEpochFixture,
  createContainerKeyWrap,
  createContainerManifestFixture,
  fixtureHash,
} from "./testFixtures";

test("verifyContainerKekState accepts additive wraps on the existing KEK epoch", async () => {
  const originalManifest = await createContainerManifestFixture({
    containerId: "additive-container",
    containerKeyEpochId: await fixtureContainerKekMaterialId(
      "additive-container-key-epoch-1",
    ),
    directGrants: [
      {
        subjectType: "user",
        subjectId: "alice",
        accessLevel: "read",
      },
    ],
  });
  const currentManifest = await createContainerManifestFixture({
    containerId: originalManifest.state.containerId,
    containerKeyEpochId: originalManifest.state.containerKeyEpochId,
    directGrants: [
      ...originalManifest.state.directGrants,
      {
        subjectType: "user",
        subjectId: "bob",
        accessLevel: "read",
      },
    ],
    epoch: 2,
    previousManifestHash: originalManifest.manifestHash,
  });
  const aliceKey: ContainerUserRecipientKey = {
    userId: "alice",
    recipientKeyEpochId: "alice-key-epoch-1",
    recipientKeyFingerprint: await fixtureHash("alice-key"),
  };
  const bobKey: ContainerUserRecipientKey = {
    userId: "bob",
    recipientKeyEpochId: "bob-key-epoch-1",
    recipientKeyFingerprint: await fixtureHash("bob-key"),
  };
  const keyEpoch = await createContainerKeyEpochFixture({
    manifest: currentManifest,
    createdByManifest: originalManifest,
  });
  const state = await verifyContainerKekState({
    containerManifest: currentManifest,
    containerManifestHistory: [originalManifest],
    keyEpoch,
    userRecipientKeys: [aliceKey, bobKey],
    wraps: [
      await createContainerKeyWrap({
        containerKeyEpochId: keyEpoch.id,
        recipientKind: "user",
        recipientId: aliceKey.userId,
        recipientKeyEpochId: aliceKey.recipientKeyEpochId,
        recipientKeyFingerprint: aliceKey.recipientKeyFingerprint,
        wrapManifestHash: originalManifest.manifestHash,
      }),
      await createContainerKeyWrap({
        containerKeyEpochId: keyEpoch.id,
        recipientKind: "user",
        recipientId: bobKey.userId,
        recipientKeyEpochId: bobKey.recipientKeyEpochId,
        recipientKeyFingerprint: bobKey.recipientKeyFingerprint,
        wrapManifestHash: currentManifest.manifestHash,
      }),
    ],
  });

  expect(state.ok).toBe(true);
  if (state.ok) {
    expect(state.value.containerKeyEpochId).toBe(
      originalManifest.state.containerKeyEpochId ?? "",
    );
    expect(state.value.wraps.map((wrap) => wrap.wrapManifestHash)).toEqual([
      originalManifest.manifestHash,
      currentManifest.manifestHash,
    ]);
  }
});
