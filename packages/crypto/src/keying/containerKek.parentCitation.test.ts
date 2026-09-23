import { expect, test } from "bun:test";
import { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import { fixtureContainerKekMaterialId as kekId } from "./containerKekMaterial.testFixtures";
import { creationParentEpochId } from "./containerKekParent";
import {
  normalizeContainerAccessEventBody,
  verifyContainerKekState,
} from "./index";
import {
  createContainerKeyEpochFixture,
  createContainerKeyWrap,
  createContainerManifestFixture,
  createVerifiedContainerAccessEvent,
  createVerifiedContainerKekStateFixture,
  expectVerificationError,
} from "./testFixtures";

test("a child parent epoch must match its signed creation citation", async () => {
  const parent = await createContainerManifestFixture({
    containerId: "parent",
    containerKeyEpochId: await kekId("parent-old", "parent"),
    directGrants: [
      { subjectType: "user", subjectId: "owner", accessLevel: "admin" },
    ],
  });
  const replacement = await createContainerManifestFixture({
    containerId: "parent",
    containerKeyEpochId: await kekId("parent-new", "parent"),
    directGrants: parent.state.directGrants,
  });
  const child = await createContainerManifestFixture({
    containerId: "child",
    containerKeyEpochId: await kekId("child-key", "child"),
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

test("withholding either of two signed parent dependencies cannot select the authoritative citation", async () => {
  const cited = await createContainerManifestFixture({
    containerId: "parent",
    containerKeyEpochId: await kekId("cited-parent", "parent"),
    directGrants: [],
  });
  const other = await createContainerManifestFixture({
    containerId: "parent",
    containerKeyEpochId: await kekId("other-parent", "parent"),
    directGrants: [],
  });
  const child = await createContainerManifestFixture({
    containerId: "child",
    containerKeyEpochId: await kekId("cited-child", "child"),
    directGrants: [],
    parentContainerId: "parent",
    parentManifestHash: cited.manifestHash,
  });
  const event = await createVerifiedContainerAccessEvent({
    body: normalizeContainerAccessEventBody(child.event.body),
    previousManifestHash: null,
    signer: generateSigningSeedAndKeyPair(),
    signerUserId: "owner",
    objectId: "child",
    organizationId: child.state.organizationId,
    dependencyManifestHashes: [cited.manifestHash, other.manifestHash].sort(),
  });
  const signed = await createContainerManifestFixture({
    containerId: "child",
    containerKeyEpochId: child.state.containerKeyEpochId,
    directGrants: [],
    parentContainerId: "parent",
    parentManifestHash: cited.manifestHash,
    event,
  });
  for (const parents of [[cited, other], [cited]]) {
    expect(
      creationParentEpochId(
        signed,
        new Map(parents.map((parent) => [parent.manifestHash, parent])),
      ),
    ).toBe(cited.state.containerKeyEpochId);
  }
  expect(() =>
    creationParentEpochId(signed, new Map([[other.manifestHash, other]])),
  ).toThrow("signed parent citation");
});
