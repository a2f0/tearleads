import { test } from "bun:test";
import { generateSigningSeedAndKeyPair } from "../signing/generateKeyPair";
import { createVerifiedContainerAccessEvent } from "./accessEvent.testFixtures";
import {
  createContainerManifestFixture,
  KEYRING_HASH,
  PREDECESSOR_BRIDGE_HASH,
} from "./containerAccess.testFixtures";
import { containerWrappingPublicKeyForTest } from "./containerWrapping.testFixtures";
import type { ContainerAccessEventBody } from "./index";
import {
  computeAccessManifestHash,
  deriveContainerAccessManifest,
  verifyContainerAccessManifest,
} from "./index";
import { expectVerificationError } from "./verificationError.testFixtures";

test("verifyContainerAccessManifest rejects moving a container under its descendant", async () => {
  const adminUserId = "admin-user";
  const adminSigning = generateSigningSeedAndKeyPair();
  const root = await createContainerManifestFixture({
    containerId: "root-container",
    containerKeyEpochId: "root-key-epoch-1",
    directGrants: [
      {
        subjectType: "user",
        subjectId: adminUserId,
        accessLevel: "admin",
      },
    ],
    signer: adminSigning,
    signerUserId: adminUserId,
  });
  const child = await createContainerManifestFixture({
    containerId: "child-container",
    containerKeyEpochId: "child-key-epoch-1",
    directGrants: [],
    parentContainerId: root.state.containerId,
    parentManifestHash: root.manifestHash,
    signer: adminSigning,
    signerUserId: adminUserId,
  });
  const grandchild = await createContainerManifestFixture({
    containerId: "grandchild-container",
    containerKeyEpochId: "grandchild-key-epoch-1",
    directGrants: [],
    parentContainerId: child.state.containerId,
    parentManifestHash: child.manifestHash,
    signer: adminSigning,
    signerUserId: adminUserId,
  });
  const body: ContainerAccessEventBody = {
    containerKeyPublicKey:
      containerWrappingPublicKeyForTest("child-key-epoch-2"),
    eventType: "container.move",
    parentContainerId: grandchild.state.containerId,
    parentManifestHash: grandchild.manifestHash,
    containerKeyEpochId: "child-key-epoch-2",
    keyringHash: KEYRING_HASH,
    predecessorBridgeHash: PREDECESSOR_BRIDGE_HASH,
  };
  const event = await createVerifiedContainerAccessEvent({
    body,
    objectId: child.state.containerId,
    organizationId: child.state.organizationId,
    previousManifestHash: child.manifestHash,
    signer: adminSigning,
    signerUserId: adminUserId,
  });
  const manifest = await deriveContainerAccessManifest({
    ...child.state,
    epoch: child.state.epoch + 1,
    previousManifestHash: child.manifestHash,
    eventHash: event.eventHash,
    parentContainerId: grandchild.state.containerId,
    parentManifestHash: grandchild.manifestHash,
    containerKeyEpochId: "child-key-epoch-2",
  });

  const result = await verifyContainerAccessManifest({
    manifest,
    expectedManifestHash: await computeAccessManifestHash(manifest),
    event,
    previousManifest: child,
    previousContainerPath: [root, child],
    destinationParentContainerPath: [root, child, grandchild],
  });

  expectVerificationError(result, "object_mismatch");
});

test("verifyContainerAccessManifest rejects moves that desync epoch and key", async () => {
  const adminUserId = "admin-user";
  const adminSigning = generateSigningSeedAndKeyPair();
  const parent = await createContainerManifestFixture({
    containerId: "move-destination-parent",
    containerKeyEpochId: "destination-key-epoch-1",
    directGrants: [
      { subjectType: "user", subjectId: adminUserId, accessLevel: "admin" },
    ],
    signer: adminSigning,
    signerUserId: adminUserId,
  });
  const originParent = await createContainerManifestFixture({
    containerId: "move-origin-parent",
    containerKeyEpochId: "origin-key-epoch-1",
    directGrants: [
      { subjectType: "user", subjectId: adminUserId, accessLevel: "admin" },
    ],
    signer: adminSigning,
    signerUserId: adminUserId,
  });
  const previous = await createContainerManifestFixture({
    containerId: "moved-container",
    containerKeyEpochId: "moved-key-epoch-1",
    directGrants: [
      { subjectType: "user", subjectId: adminUserId, accessLevel: "admin" },
    ],
    parentContainerId: originParent.state.containerId,
    parentManifestHash: originParent.manifestHash,
    signer: adminSigning,
    signerUserId: adminUserId,
  });
  // An unchanged epoch that republishes a different wrapping key would send
  // descendants to a key the container's real KEK cannot open.
  const movedEpochId = previous.state.containerKeyEpochId ?? "";
  const body: ContainerAccessEventBody = {
    containerKeyPublicKey: containerWrappingPublicKeyForTest("unrelated-epoch"),
    eventType: "container.move",
    parentContainerId: parent.state.containerId,
    parentManifestHash: parent.manifestHash,
    containerKeyEpochId: movedEpochId,
    keyringHash: KEYRING_HASH,
    predecessorBridgeHash: PREDECESSOR_BRIDGE_HASH,
  };
  const event = await createVerifiedContainerAccessEvent({
    body,
    objectId: previous.state.containerId,
    organizationId: previous.state.organizationId,
    previousManifestHash: previous.manifestHash,
    signer: adminSigning,
    signerUserId: adminUserId,
  });
  const manifest = await deriveContainerAccessManifest({
    ...previous.state,
    epoch: previous.state.epoch + 1,
    previousManifestHash: previous.manifestHash,
    eventHash: event.eventHash,
    parentContainerId: body.parentContainerId,
    parentManifestHash: body.parentManifestHash,
    containerKeyEpochId: body.containerKeyEpochId,
    containerKeyPublicKey: body.containerKeyPublicKey,
  });

  const result = await verifyContainerAccessManifest({
    manifest,
    expectedManifestHash: await computeAccessManifestHash(manifest),
    event,
    previousManifest: previous,
    previousContainerPath: [originParent, previous],
    destinationParentContainerPath: [parent],
  });

  expectVerificationError(result, "key_epoch_reuse");
});
