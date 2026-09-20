import { expect, test } from "bun:test";
import { fixtureContainerKekMaterialId as kekId } from "./containerKekMaterial.testFixtures";
import { verifyContainerKekState } from "./index";
import {
  createContainerKeyEpochFixture,
  createContainerKeyWrap,
  createContainerManifestFixture,
  createVerifiedContainerKekStateFixture,
  expectVerificationError,
} from "./testFixtures";

test("a child parent epoch must match its signed creation citation", async () => {
  const parent = await createContainerManifestFixture({
    containerId: "parent",
    containerKeyEpochId: await kekId("parent-old"),
    directGrants: [
      { subjectType: "user", subjectId: "owner", accessLevel: "admin" },
    ],
  });
  const replacement = await createContainerManifestFixture({
    containerId: "parent",
    containerKeyEpochId: await kekId("parent-new"),
    directGrants: parent.state.directGrants,
  });
  const child = await createContainerManifestFixture({
    containerId: "child",
    containerKeyEpochId: await kekId("child-key"),
    directGrants: [],
    parentContainerId: "parent",
    parentManifestHash: parent.manifestHash,
  });
  const verifyAgainst = async (manifest: typeof parent) => {
    const parentKek = await createVerifiedContainerKekStateFixture({
      manifest,
      recipientUserId: "owner",
    });
    const keyEpoch = await createContainerKeyEpochFixture({
      manifest: child,
      parentContainerKeyEpochId: parentKek.containerKeyEpochId,
    });
    return verifyContainerKekState({
      containerManifest: child,
      keyEpoch,
      parentKekState: parentKek,
      parentManifestHistory: [parent, replacement],
      wraps: [
        await createContainerKeyWrap({
          containerKeyEpochId: keyEpoch.id,
          recipientKind: "container",
          recipientId: parentKek.containerId,
          recipientKeyEpochId: parentKek.containerKeyEpochId,
          recipientKeyFingerprint: parentKek.keyEpochHash,
          wrapManifestHash: child.manifestHash,
        }),
      ],
    });
  };

  expect((await verifyAgainst(parent)).ok).toBe(true);
  // A self-consistent replacement epoch record and target cannot change the
  // parent citation already committed by the child's signed creation event.
  expectVerificationError(await verifyAgainst(replacement), "key_epoch_reuse");
});
